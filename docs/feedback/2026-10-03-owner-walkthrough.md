# Owner walkthrough of v2: notes to act on

The owner tried v2 for the first time on 2026-10-03, in the local preview
with the "Existing money" demo account (demonstrations 2–10). These are
their spoken notes, cleaned up and checked against the app. Nothing here
has been built yet.

**The main finding:** the money model is right, but the screens show too
much at once. The owner could not see where to start or how to get around.

## Notes, in the order they came up

1. **Sign-in page: needs a redesign.** Today it is a plain card. In the
   preview it also shows the amber "Local preview" panel with the two demo
   buttons.
   - *Direction:* a short line on what the app does, then sign-in. Keep the
     demo buttons clearly apart as "try it with sample data".

2. **Home: "Needs your attention" and "Upcoming bills" are overwhelming at
   first sight.** Correct. Home shows all of these at once: the equation,
   the wallets, net worth, alerts and bills.
   - *Direction:* lead with one thing, such as Ready to assign or "what to do
     next". Fold the rest behind it, or move it lower down.

3. **Plan: switching months works and feels good.** Keep it. The summary
   figures (Expected, Received, Funded, Still to fund, Ready to assign) were
   understood.

4. **Plan → "Edit plan" pop-up is the worst screen.** It shows every group
   (Essentials, Guilt free, Short-term goals, Savings, Investments) and all
   their items in one wide dialog. The owner suggested tabs or steps.
   - *Direction:* edit one group at a time, as tabs or steps, with the
     totals (expected income, % planned, not planned) always visible. Or edit
     a group from its own card on the Plan page.

5. **"Where is the guided tour?"** *Correction:* it exists, under Settings →
   "Guided tour: the ten demonstrations", and only in the local preview. It
   is too hard to find.
   - *Direction:* offer it when someone first signs in to a demo account, as
     a banner or button on Home, not only in Settings.

6. **It is unclear where things are done.** The Record button offers eight
   kinds: Expense, Income, Transfer, Move money, Exchange, Invest, Loan and
   Refund. Adding a wallet is somewhere else, under Accounts → Add. Home
   shows "Add a wallet" only when there is no wallet yet.
   - *Direction:* show the three common kinds first (Expense, Income, Move
     money) and put the rest under "More". Let people add a wallet from
     wherever wallets are listed.

7. **Overall: "very overwhelming, I don't know how to navigate it."** This is
   the same cause as notes 2, 4 and 6.
   - *Direction:* a "first-run simplification" pass: one main action per
     screen, and details only on request. Write it as a design spec first,
     then build.

8. **The demo itself is not clear.** This is interpreted from a voice note
   that was partly garbled.
   - *Direction:* the tour should tell the story one step at a time, each
     step opening the screen it explains.

## Done during the walkthrough

- The local preview database and the browser sign-in were reset, so the
  owner could start over (2026-10-03). This was local only; production was
  not touched.

## Suggested order for a future session

1. Brainstorm and write a spec for notes 2, 4, 6 and 7 together. They share
   one cause, and fixing them one by one would give four different patterns.
2. Note 5 (tour discoverability) and note 8 (tour story) go into the same
   pass.
3. Note 1 (sign-in) can be done on its own at any time.
