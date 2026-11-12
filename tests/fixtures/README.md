# Browser data fixture

The Iono Lightning and Dragonite decks, plus their verified card records, are held in this app's local browser storage and are not part of the source tree. To create the test fixture without exporting unrelated library data:

1. Open the local app in the same browser profile that contains both decks and their verified card details.
2. Open **Deck library** and choose **Export match test data**.
3. If export reports missing metadata, update those exact card prints in the card library and repeat. The app will not substitute approximate card details.
4. Save the downloaded `iono-lightning-vs-dragonite.fixture.json` in this folder.
5. Run the Node test suite again.

The export contains only those two decklists and the verified card records referenced by them, including current effect support and handler identifiers. It omits all other decks, cards, statistics, and browser storage.

Until that export is present, the deck-dependent fixture test is explicitly skipped. No deck list or metadata should be hand-created for this test.

The checked-in fixture has now been verified and updated for the supported effects of all 40 printings. Source labels identify the card records checked against Limitless. Known legacy Rare Candy and Exp. Share text has been corrected, the three independently verified damage-only attacks have explicit completeness markers, and Dragonite ex includes its Tera protection rule. Both Iono designs retain their individual print IDs and share the same effect.

`metal-and-japanese-cards.fixture.json` contains 23 additional exact English prints and five exact Japanese prints with Limitless's unofficial English translations, verified on 3 November 2026. Each records a direct source URL. Japanese records retain Japanese artwork, print language and separate English text provenance. Null damage-only text is supplied only after independently checking the exact attack, cost and damage. English images are deliberately omitted from this regression fixture because the existing saved artwork is preserved. The synthetic 60-card decks in `metal-full-match.integration.test.cjs` test the new rules and are not presented as the user's browser decklists.

`fire-deck-cards.fixture.json` contains the 13 exact pending printings from the user’s Fire-deck export, checked against linked Limitless pages. Skeledirge ex PAR 137’s Metal type, Grass Resistance −30, and Tera rule are retained; Mew CEL 11’s Fighting Resistance is −30. Those numeric Resistance values and Skeledirge’s rules were cross-checked against the Pokémon TCG API data repository (`cards/en/sv4.json` and `cards/en/cel25.json`). Missing damage-only text was filled only after checking each exact attack. The two full Fire-match regressions use explicit synthetic 60-card lists because the export provided pending cards rather than deck quantities; they are not replacements for saved browser decks.

`revavroom-rescue-board.fixture.json` records Revavroom TWM 125 and Rescue Board PRE 126, verified from their exact Limitless pages. Revavroom’s Grass Resistance −30 was cross-checked against `cards/en/sv6.json` in the Pokémon TCG API data repository. Full-match regressions use synthetic 60-card lists with verified Varoom PAF 64; no saved browser deck quantities are inferred.

`water-deck-cards.fixture.json` records the 13 pending Water-deck printings verified on 6 November 2026, with a direct Limitless URL for each. The raw fixture preserves missing damage-only text and Palkia VSTAR's omitted Ability/Rule Box so the exact metadata repair is tested. Star Portal, V/VSTAR and Radiant rules are supplied only for matching verified print signatures. Existing saved artwork is preserved. The official [Advanced Player’s Rulebook](https://asia.pokemon-card.com/sg/wp-content/uploads/sites/6/2025/10/EN_advanced_manual-2025.pdf) supports the shared cost, damage, Stadium and Knock Out ordering, and Pokémon's [Palkia VSTAR strategy](https://www.pokemon.com/us/strategy/origin-forme-palkia-vstar-deck-strategy) cross-checks Star Portal. Full-match tests use explicitly synthetic 60-card lists because the pending export contains no deck quantities.
