# Browser checks for the adjustable playmat

Status on 3 November 2026: **not run in a real browser**. The connected browser timed out loading the local development URL. Automated engine and simulated-document checks run separately with `node --test tests/*.test.cjs`.

Use the normal local app and a verified pair of registered decks. Perform at 1440×900, 1280×800, 900×800, and 390×844, plus the largest text setting. Use a fresh test library or a backup when needed.

| Check | Expected result |
| --- | --- |
| Opening setup | Opposing Active and Bench stay face down; only counts are shown. Own Bench, hand, deck, discard, and Prizes remain accessible. |
| Layout | Five Bench slots fit across each side. Your Prizes are left, your deck/discard right; opponent mirrors this. Stadium sits between the two Active Pokémon; both last-played areas are visible. No zone or control overlaps another. Short screens can scroll. |
| History & chat | Visible by default on the right on desktop. The top toggle and panel Hide button work; the AI controls, move log, and game summary remain usable. On small screens the panel appears below the mat and Inspector. |
| Panel dividers | Drag either divider in both directions. Inspector/history resize while the playmat stays usable. Check keyboard arrows, Shift, Home/End, Escape cancellation, lost capture, and double-click reset. Refresh to check saved sizes. Shrink and re-expand the window; previous desktop widths return. |
| Inspector | Artwork uses the full panel width; no repeated English effect paragraphs appear alongside it. Remaining HP, attached Energy/units, Weakness, Resistance, Retreat, Conditions and Tools remain readable at every panel width. Japanese translation and missing-image text are available through their collapsed fallback. |
| Energy placement | Drag a Basic Energy from hand onto a highlighted own Pokémon. Exactly one card attaches and the once-per-turn allowance is used. Dropping on an opponent or invalid target makes no change. Repeat using click selection. |
| Larger hand | Cards are substantially larger and fully visible, including when a horizontal scrollbar appears. With a large hand, the first and last cards remain reachable by scrolling. With a small hand, cards are centered. Compact Benches leave room for the hand while the Inspector and History remain visible on desktop. |
| Piles and Prizes | Deck/discard piles and Prize backs are larger; the top discard and all counts remain readable. The Prize grid adapts to narrow mats without revealing hidden identities. |
| Opponent movement | Watch AI Basic Pokémon, Energy, Supporter, Tool and Evolution plays. Cards start at the upper opponent hand; opponent draws/recovery/Prizes end there. Both players’ hand shuffles move from their respective sides. Empty-hand and paused/manual Control modes never redirect an opponent animation to your bottom hand. |
| Coin-first choices | Pokémon Catcher shows the coin first. Tails requires no target; heads then highlights the legal opposing Bench. Effects off and reduced motion retain the same resolution order. |
| Water-deck choices | Super Cold selects multiple Basic Water Energy on the right and assigns each by clicking a Pokémon. Star Portal can be cancelled before commitment and is unavailable after its one game use. Shivery Chill searches only from the Active Spot; after revealing the deck, Cancel stays disabled. Moonlight Shuriken selects Energy and two different opposing targets through the same right-side panel and playmat highlights. |
| Knockout | The departing Pokémon’s effect completes before its replacement appears. Input remains locked through the transition. Prize movement and each side’s remaining counts agree. |
| Checkpoint | Complete an attachment, refresh, and resume from the main menu. The same card is attached, hand/deck order is unchanged, and the attachment allowance remains used. |
| Unfinished choice | Refresh while a card/board picker or coin is pending. Resume the previous completed action, with no partial discard, attachment, or draw. |
| AI resume | Refresh on the opponent’s turn and resume. The AI continues once, with no duplicate start-of-turn draw. |
| Reminders | Use Thunderous Bolt, Roost, Metal Defender, and Iron Defender. Check source/expiry in the Inspector and the matching badge on the Pokémon. End the required turns; expired badges disappear. |
| Recovery and finish | A finished match has a summary and per-deck history, with no unfinished-game offer after refresh. A library restore clears an older unfinished game. |
| Storage failure | In a browser profile where saving is unavailable/full, a visible message says that the game could not be saved; gameplay remains usable. |
| Attack preview | Select an Active Pokémon, change its selected attack, and attach Energy. Check cost, availability, damage, coin outcomes, remaining HP and Knockout risks. Opening/changing a preview never flips a coin or changes the match. Estimates stop before Pokémon Checkup. |
| HP display | Check total HP, damage and remaining HP on the mat and Inspector, including Bravery Charm, healing and evolution. No damage-counter count is shown in the live HP display. |
| Attached Tools | Attach a Tool and inspect it using its outward title tab or the Pokémon Inspector’s Tools entry. Its artwork/effect appear without offering a second play action. Verify four distinct Tool tabs on Tune-up Revavroom ex and no opponent Tool exposure during setup. |
| Cancellation | Cancel a Supporter’s playmat target or an Item’s hand/discard choice. The card, cost and Supporter allowance remain available. Repeat the play successfully. Cancel Retreat without spending Energy or the Retreat allowance. |
| Revealed deck | Open Great Ball, Pokégear or another deck selection. Cancel, close and Escape cannot abort the revealed effect; Undo is disabled. Finish an optional search with no card selected. Subsequent playmat targets also require completion after a reveal. |
| Fire deck | Refresh and run Update all cards. Verify all 13 pending Fire-deck printings become Implemented. Try Incendiary Song, Dual Turbo, Mysterious Tail, Super Rod, Superior Energy Retrieval and Magma Basin; check costs, targets, once-per-turn usage and recovery exclusions. |
| Rigid Band | Attach to a Basic Pokémon legally. Its 30-damage reduction becomes active at Stage 1 and stops at Stage 2. Compare the attack preview with damage actually applied. |
| Revavroom TWM 125 | Rally Back shows 120 after a qualifying attack-damage Knockout on the last opposing turn, otherwise 30. Running Charge’s examples have no fixed maximum, each flip appears before damage, and flipping stops at the first tails. |
| Rescue Board PRE 126 | Check the one-Energy reduction at 31 remaining HP and free Retreat at 30 HP. Heal above 30 and check the restored reduced cost. Sleep, Paralysis and Retreat restrictions still prevent Retreat. Inspect the Tool through its title tab. |

Record the viewport, browser version, result, and screenshot for any failure. The app’s **Report a problem** download captures engine context for follow-up.
