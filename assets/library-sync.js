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
    write:(expected_revision,library_data)=>rpc('playmat_library_write',{expected_revision,library_data})
  };
}

function mountPlaymatLibrarySync({projectUrl,publishableKey,snapshot,apply,validate,canSync}) {
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
      status.textContent = 'Library synced. Match history and recordings stay on this device.';
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
    }
  });
  syncButton.addEventListener('click',()=>void sync());
  byId('librarySyncUseCloud').addEventListener('click',()=>void sync('cloud'));
  byId('librarySyncKeepLocal').addEventListener('click',()=>void sync('local'));
  window.addEventListener('focus',()=>void sync());
  window.addEventListener('online',()=>void sync());
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) void sync(); });
  refreshUi();
  if (client.getSession()) { status.textContent = 'Checking your private library…'; schedule(400); }
  else status.textContent = 'Sign in with your private library account.';
  return {changed:()=>schedule(500)};
}

if (typeof module === 'object' && module.exports) module.exports = {librarySyncDecision,canonicalLibraryJson,createLibrarySyncClient};
