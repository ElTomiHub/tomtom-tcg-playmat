'use strict';

function librarySyncDecision({local, remote, empty, baseline}) {
  if (!remote) return 'upload';
  if (local === remote.hash) return 'matched';
  if (!baseline) return empty ? 'download' : 'conflict';
  const localChanged = local !== baseline.hash;
  const remoteChanged = remote.revision !== baseline.revision;
  if (localChanged && remoteChanged) return 'conflict';
  if (localChanged) return 'upload';
  if (remoteChanged) return 'download';
  return 'conflict';
}

function canonicalLibraryJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalLibraryJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalLibraryJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function createLibrarySyncClient({projectUrl,publishableKey,storage,fetcher,clock = Date.now}) {
  const url = new URL(projectUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) ||
      url.pathname !== '/' || url.port || url.username || url.password || url.search || url.hash ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('The private library connection is not configured correctly.');
  }
  const sessionKey = 'codexPokemonPlaymat.syncSession.v1.' + url.hostname;
  const getSession = () => {
    try { return JSON.parse(storage.getItem(sessionKey) || 'null'); }
    catch { return null; }
  };
  const resetSession = () => storage.removeItem(sessionKey);
  async function request(path,{body,token} = {}) {
    const response = await fetcher(url.origin+path,{
      method:'POST', cache:'no-store',
      headers:{apikey:publishableKey,'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token} : {})},
      ...(body===undefined ? {} : {body:JSON.stringify(body)})
    });
    if (!response.ok) {
      const error = new Error('The private library could not be reached.');
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async function getToken(grant, credentials) {
    const data = await request('/auth/v1/token?grant_type='+grant,{body:credentials});
    if (!data?.access_token || !data.refresh_token || !data.user?.id) throw new Error('Sign-in did not return a valid session.');
    const session = {userId:data.user.id,access_token:data.access_token,refresh_token:data.refresh_token,
      expires_at:data.expires_at || Math.floor(clock()/1000)+data.expires_in};
    if (grant === 'refresh_token') {
      const latest = getSession();
      if (!latest) throw new Error('Sign in to sync your library.');
      if (latest.refresh_token !== credentials.refresh_token) return latest;
    }
    storage.setItem(sessionKey, JSON.stringify(session));
    return session;
  }
  let refreshing;
  async function currentSession() {
    const session = getSession();
    if (!session) throw new Error('Sign in to sync your library.');
    if (session.expires_at*1000>clock()+45000) return session;
    if (!refreshing) {
      const refresh = async () => {
        const latest = getSession();
        if (!latest) throw new Error('Sign in to sync your library.');
        if (latest.expires_at*1000>clock()+45000) return latest;
        try { return await getToken('refresh_token',{refresh_token:latest.refresh_token}); }
        catch (error) {
          if ([400,401,403].includes(error.status) && getSession()?.refresh_token===latest.refresh_token) resetSession();
          throw error;
        }
      };
      refreshing = (globalThis.navigator?.locks?.request(sessionKey,refresh) || refresh()).finally(()=>{refreshing=null;});
    }
    return refreshing;
  }
  async function rpc(name, body) {
    const session = await currentSession();
    return request('/rest/v1/rpc/'+name,{body,token:session.access_token});
  }
  return {
    getSession,
    baselineKey: userId=>'codexPokemonPlaymat.syncBaseline.v1.'+url.hostname+'.'+userId,
    async signIn(email,password) {
      await getToken('password',{email,password});
      try { await rpc('playmat_library_read',{}); }
      catch (error) { resetSession(); throw error; }
    },
    async signOut() {
      const session = getSession();
      if (!session) return;
      try { await request('/auth/v1/logout?scope=local',{token:session.access_token}); }
      finally { resetSession(); }
    },
    read:()=>rpc('playmat_library_read',{}),
    readProgress:()=>rpc('playmat_progress_read',{}),
    writeProgress:(expected_revision,progress_data)=>rpc('playmat_progress_write',{expected_revision,progress_data}),
    write:(expected_revision,library_data)=>rpc('playmat_library_write',{expected_revision,library_data})
  };
}

function mountPlaymatLibrarySync({projectUrl,publishableKey,snapshot,apply,validate,canSync,progress}) {
  const byId = id=>document.getElementById(id);
  const panel = byId('librarySyncPanel'), form = byId('librarySyncForm'), controls = byId('librarySyncControls');
  const status = byId('librarySyncStatus'), choices = byId('librarySyncConflict');
  if (!projectUrl || !publishableKey) {
    status.textContent = 'Private sync is awaiting site setup. Your library stays saved in this browser.';
    return null;
  }
  let client;
  try { client = createLibrarySyncClient({projectUrl,publishableKey,storage:localStorage,fetcher:window.fetch.bind(window)}); }
  catch (error) { status.textContent = error.message; return null; }
  const progressSync = progress && mountPlaymatProgressSync(client,progress);
  let running = false, conflict = null, timer;
  const syncButton = byId('librarySyncNow'), signOut = byId('librarySyncSignOut');
  const syncButtons = [syncButton,signOut,byId('librarySyncUseCloud'),byId('librarySyncKeepLocal'),byId('librarySyncSignIn')];
  function refreshUi() {
    const signedIn = !!client.getSession();
    form.hidden = signedIn;
    controls.hidden = !signedIn;
    choices.hidden = !signedIn || !conflict;
    for (const button of syncButtons) button.disabled = running;
  }
  const digest = async library => {
    const bytes = new TextEncoder().encode(canonicalLibraryJson(library));
    const hash = await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
  };
  function baselineFor(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }
  const remember = (key,revision,hash)=>localStorage.setItem(key,JSON.stringify({revision,hash}));
  function schedule(delay = 30000) {
    clearTimeout(timer);
    if (client.getSession()) timer = setTimeout(()=>void sync(),delay);
  }
  async function sync(preference = '') {
    const session = client.getSession();
    if (!session || running) return;
    if (conflict && !preference) return;
    if (!canSync()) {
      if (preference || !panel.closest('.modal-backdrop')?.classList.contains('hidden')) {
        status.textContent = 'Finish your match or close the current deck edit before syncing.';
      }
      schedule();
      return;
    }
    running = true;
    refreshUi();
    try {
      const cloud = await client.read();
      if (!Number.isSafeInteger(cloud?.revision) || cloud.revision<0 || (cloud.revision===0)!==(cloud.library===null)) {
        throw new Error('The server returned an invalid library revision.');
      }
      const local = snapshot();
      const localHash = await digest(local);
      const remoteLibrary = cloud.library===null ? null : validate(cloud.library);
      const remoteHash = remoteLibrary ? await digest(remoteLibrary) : null;
      const key = client.baselineKey(session.userId);
      if (client.getSession()?.userId!==session.userId) return;
      if (!canSync()) { status.textContent = 'Sync paused while the playmat is busy.'; return; }
      const decision = librarySyncDecision({local:localHash,
        remote:remoteLibrary && {revision:cloud.revision,hash:remoteHash},
        empty:Object.entries(local).every(([name,items])=>name==='schemaVersion' || items.length===0),
        baseline:baselineFor(key)});
      if (preference && (conflict?.revision!==cloud.revision || conflict?.localHash!==localHash)) {
        conflict = {revision:cloud.revision,localHash};
        status.textContent = 'A copy changed while you were deciding. Review the choice again.';
        return;
      }
      const action = preference==='local' ? 'upload' : preference==='cloud' ? 'download' : decision;
      if (action==='conflict') {
        conflict = {revision:cloud.revision,localHash};
        status.textContent = 'This device and your online library have different edits. Either option replaces the other copy.';
        return;
      }
      if (action==='upload') {
        const revision = await client.write(cloud.revision,local);
        if (revision===null) {
          conflict = null;
          status.textContent = 'The online library changed. Checking it again before saving.';
          return;
        }
        if (revision!==cloud.revision+1) throw new Error('The server did not confirm the save.');
        remember(key,revision,localHash);
      } else if (action==='download') {
        if (!remoteLibrary) throw new Error('There is no saved online library to download.');
        if (canonicalLibraryJson(snapshot())!==canonicalLibraryJson(local)) {
          conflict = null;
          status.textContent = 'Your library changed here. Checking again before applying the online copy.';
          return;
        }
        apply(remoteLibrary);
        remember(key,cloud.revision,remoteHash);
      } else {
        remember(key,cloud.revision,remoteHash);
      }
      conflict = null;
      status.textContent = 'Library synced.';
    } catch (error) {
      status.textContent = !client.getSession() ? 'Your session ended. Sign in to continue syncing.' :
        error.status ? 'Sync is unavailable right now. Your local library is still saved.' :
          (error.message || 'Sync failed. Your local library is still saved.');
    } finally {
      running = false;
      refreshUi();
      schedule();
    }
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (running) return;
    running = true;
    refreshUi();
    const password = byId('librarySyncPassword');
    try {
      await client.signIn(byId('librarySyncEmail').value.trim(),password.value);
      status.textContent = 'Signed in. Checking your library…';
      progressSync?.changed();
    } catch (error) {
      status.textContent = error.status===403 ? 'This account is not the configured library owner.' :
        'Sign-in failed. Check your email, password, and site setup.';
    } finally {
      password.value = '';
      running = false;
      refreshUi();
    }
    void sync();
  });
  signOut.addEventListener('click',async ()=>{
    if (running) return;
    running = true;
    refreshUi();
    try { await client.signOut(); } catch {}
    finally {
      conflict = null;
      clearTimeout(timer);
      running = false;
      refreshUi();
      status.textContent = 'Signed out on this device. Your local library is still available.';
      progressSync?.signedOut();
    }
  });
  syncButton.addEventListener('click',()=>{ void sync(); progressSync?.syncNow(); });
  byId('librarySyncUseCloud').addEventListener('click',()=>void sync('cloud'));
  byId('librarySyncKeepLocal').addEventListener('click',()=>void sync('local'));
  window.addEventListener('focus',()=>void sync());
  window.addEventListener('online',()=>void sync());
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) void sync(); });
  refreshUi();
  if (client.getSession()) { status.textContent = 'Checking your private library…'; schedule(400); }
  else status.textContent = 'Sign in with your private library account.';
  return {changed:()=>schedule(500),progressChanged:()=>progressSync?.changed()};
}

if (typeof module === 'object' && module.exports) module.exports = {librarySyncDecision,canonicalLibraryJson,createLibrarySyncClient,progressStatsDelta,mergePlaymatProgress};

const PROGRESS_MATCH_SUFFIX = /:(you|codex)$/;
const UNSAFE_PROGRESS_KEYS = new Set(['__proto__','constructor','prototype']);

function progressStatsDelta(before, after) {
  const delta = {};
  for (const [key,value] of Object.entries(after || {})) {
    if (key==='history' || UNSAFE_PROGRESS_KEYS.has(key)) continue;
    const previous = before?.[key];
    if (Number.isSafeInteger(value)) {
      const increase = value-Math.max(0,Number(previous) || 0);
      if (increase>0) delta[key] = key==='bestWins' || key==='trophy' ? value : increase;
      else if (value===0 && previous===undefined) delta[key] = 0;
    } else if (typeof value==='boolean' || typeof value==='string') {
      if (value!==previous) delta[key] = value;
    } else if (value && typeof value==='object' && !Array.isArray(value)) {
      const changes = progressStatsDelta(previous,value);
      if (Object.keys(changes).length || previous===undefined) delta[key] = changes;
    }
  }
  return delta;
}

function addProgressStats(target, delta) {
  for (const [key,value] of Object.entries(delta)) {
    if (UNSAFE_PROGRESS_KEYS.has(key) || key==='history') throw new Error('Invalid progress counter.');
    const existing = Object.hasOwn(target,key) ? target[key] : undefined;
    if (Number.isSafeInteger(value) && value>=0) {
      target[key] = ['bestWins','trophy'].includes(key) ? Math.max(existing || 0,value) : (existing || 0)+value;
    } else if (typeof value==='string' || typeof value==='boolean') {
      target[key] = value;
    } else if (value && typeof value==='object' && !Array.isArray(value)) {
      target[key] = existing && typeof existing==='object' ? existing : {};
      addProgressStats(target[key],value);
    } else throw new Error('Invalid progress counter.');
  }
}

function newerCampaignRun(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  if (current.id===incoming.id) {
    if (current.results.some((result,index)=>index<incoming.results.length && result!==incoming.results[index])) {
      return current;
    }
    return incoming.results.length>=current.results.length ? incoming : current;
  }
  const started = run=>Number(/^match-(\d+)-/.exec(run.id)?.[1] || 0);
  return started(incoming)>started(current) || (started(incoming)===started(current) && incoming.id>current.id) ? incoming : current;
}

function mergePlaymatProgress(cloud, events) {
  const merged = JSON.parse(JSON.stringify(cloud));
  const receipts = new Set(merged.receipts);
  const historicalIds = new Set(Object.values(merged.deckStats).flatMap(stats=>
    (stats.history || []).map(match=>match.id.replace(PROGRESS_MATCH_SUFFIX,''))));
  for (const event of events) {
    if (receipts.has(event.id)) continue;
    if (event.campaign) {
      const current = merged.campaign;
      merged.campaign = newerCampaignRun(current,event.campaign);
      if (event.id.startsWith('campaign-finish:') && current?.id===event.campaign.id &&
          merged.campaign.results.join()!==event.campaign.results.join()) continue;
    }
    if (!historicalIds.has(event.id)) {
      addProgressStats(merged.deckStats,event.stats || {});
      for (const summary of event.summaries || []) {
        const deckId = summary.decks[summary.perspective].id;
        if (!deckId || UNSAFE_PROGRESS_KEYS.has(deckId)) continue;
        const stats = merged.deckStats[deckId] ||= {plays:0,completed:0,wins:0,losses:0,draws:0,cards:{}};
        stats.history = [summary,...(stats.history || [])].sort((a,b)=>
          b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id)).slice(0,20);
      }
    }
    receipts.add(event.id);
  }
  merged.receipts = [...receipts];
  return merged;
}

function mountPlaymatProgressSync(client,{snapshot,apply,validate,events,acknowledge,canSync}) {
  const status = document.getElementById('progressSyncStatus');
  const review = document.getElementById('progressSyncReview');
  const useOnline = document.getElementById('progressSyncUseOnline');
  let timer, running = false, awaitingReview = false, reviewAccepted = false, seedRequested = false;
  const keyFor = userId=>client.baselineKey(userId)+'.progress';
  const serialized = value=>canonicalLibraryJson(value);
  function schedule(delay = 30000) {
    clearTimeout(timer);
    if (client.getSession()) timer = setTimeout(()=>void sync(),delay);
  }
  async function sync(acceptOnline = false) {
    const session = client.getSession();
    if (!session || running || (awaitingReview && !acceptOnline && !reviewAccepted)) return;
    reviewAccepted ||= acceptOnline;
    if (!canSync()) { schedule(); return; }
    running = true;
    useOnline.disabled = true;
    let retry = false, onlineSaved = false;
    try {
      const remote = await client.readProgress();
      if (client.getSession()?.userId!==session.userId || !canSync()) return;
      if (!Number.isSafeInteger(remote?.revision) || remote.revision<0 || (remote.revision===0)!==(remote.progress===null)) {
        throw new Error('The online progress format is invalid.');
      }
      const key = keyFor(session.userId);
      const pending = await events();
      if (client.getSession()?.userId!==session.userId || !canSync()) return;
      const local = snapshot();
      const pendingIds = pending.map(event=>event.id);
      const cloud = remote.progress===null ? null : validate(remote.progress);
      const baseline = localStorage.getItem(key);
      if (!cloud && !seedRequested) {
        status.textContent = 'To start syncing results, click Sync now on the device with the history you want to keep.';
        return;
      }
      const same = cloud && serialized(local)===serialized({deckStats:cloud.deckStats,campaign:cloud.campaign});
      const hasLocal = Object.keys(local.deckStats).length || local.campaign;
      if (cloud && !same && !baseline && hasLocal && !reviewAccepted) {
        awaitingReview = true;
        review.hidden = false;
        status.textContent = 'This browser has older progress that differs from the online copy. Download a backup before switching to online progress. New matches are queued to sync.';
        return;
      }
      const merged = cloud ? mergePlaymatProgress(cloud,pending) :
        {schemaVersion:1,...local,receipts:pendingIds};
      validate(merged);
      if (!cloud || merged.receipts.length!==cloud.receipts.length) {
        const revision = await client.writeProgress(remote.revision,merged);
        if (revision===null) { retry = true; return; }
        if (revision!==remote.revision+1) throw new Error('The server did not confirm the progress save.');
        if (!cloud) localStorage.setItem(key,'1');
      }
      onlineSaved = true;
      if (client.getSession()?.userId!==session.userId) return;
      await acknowledge(pendingIds);
      if (client.getSession()?.userId!==session.userId || !canSync()) return;
      if (serialized(snapshot())!==serialized(local)) {
        retry = true;
        return;
      }
      if (serialized(local)!==serialized({deckStats:merged.deckStats,campaign:merged.campaign})) apply(merged);
      localStorage.setItem(key,'1');
      awaitingReview = false;
      reviewAccepted = false;
      seedRequested = false;
      review.hidden = true;
      status.textContent = 'Results, statistics, badges and campaign progress synced.';
    } catch (error) {
      status.textContent = error.status===404 ? 'Progress sync is awaiting database setup.' :
        onlineSaved ? 'Your online progress is saved. This browser could not update its local copy.' :
          'Progress sync is temporarily unavailable. Keep this tab open to retry.';
    } finally {
      running = false;
      useOnline.disabled = false;
      schedule(retry ? 800 : 30000);
    }
  }
  useOnline.addEventListener('click',()=>void sync(true));
  window.addEventListener('focus',()=>void sync());
  window.addEventListener('online',()=>void sync());
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) void sync(); });
  schedule(600);
  return {
    changed:()=>schedule(600),
    syncNow:()=>{ seedRequested = true; schedule(0); },
    signedOut:()=>{
      clearTimeout(timer);
      awaitingReview = false;
      reviewAccepted = false;
      seedRequested = false;
      review.hidden = true;
      status.textContent = '';
    }
  };
}
