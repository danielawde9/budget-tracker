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

## Second walkthrough: fresh start, then existing money

The owner set up the empty "Fresh start" account, tried every record kind,
then went back to the "Existing money" demo. Checked against the code and the
owner's own local data.

**Bugs (fix first)**

9. **Setup, "Where is your money today?": Next throws away a wallet you
   filled in but did not Add.** Confirmed in
   `src/screens/onboarding/onboarding.tsx` (`MoneyStep`, Next is always
   enabled). The owner then landed on Home, which asked them to "Add a
   wallet" again.
   - *Fix:* Next adds the filled-in wallet, or asks first. It never drops
     it silently. Add a test.

10. **The "wallet added" message shows the amount without its sign.**
    `WalletForm` builds it from the typed amount, so a wallet in debt (−100)
    is announced as 100. Small, but it matches the overdraft confusion in
    note 12.

**Wording and understanding**

11. **Setup step 1 asks for expected income in USD only. "What about LBP?"**
    This is by design: the plan is sized in USD, and LBP money sits in the
    same items with its own balance and is assigned by hand. Setup never
    says so.
    - *Direction:* one line in step 1 explaining where LBP goes.

12. **The overdraft checkbox is unclear.** "This balance is negative (a card
    or overdraft)" flips the sign of the amount you typed, so 100 becomes
    −100.
    - *Direction:* replace the checkbox with a choice: "I have this money" or
      "I owe this money".

13. **"Must I put money in each item?" No, it is optional.** Each group's
    % sets its size, and the group's flexible item gets whatever the items
    don't take. The plan editor (in setup and in "Edit plan", note 4)
    doesn't say this.

14. **Spending more than an item holds made sense only after a while.** The
    message was "Rent has $0.00. The other $100.00 will come from:" followed
    by a Ready to assign choice.
    - *Direction:* plainer words, such as "Rent is empty. Take the missing
      $100 from:", with a one-line reason.

15. **Transfer and Move money are easy to confuse.**
    - Transfer moves real money between wallets, for example bank to cash.
    - Move money changes what money is for, between plan items. No money
      changes place.
    - *Direction:* names that say this, such as "Between wallets" and "Change
      what money is for".

16. **Investments: "Contribute" and "Update value" are unclear.** The owner's
    numbers were right:
    - 100 opening + 50 contributed = 150.
    - "Update value: 100" means "it is worth 100 now", so it recorded a $50
      loss.
    - Withdrawing 50 left 50, and the cash got 50 back.

    The form never showed the current value or the gain or loss before
    saving.
    - *Direction:* rename "Contribute" to "Put money in". Rename "Update
      value" to "What is it worth now?". Show the current value and preview
      "this records a $50 loss" before saving.

17. **The words on Home and Plan are still not clear in the existing-money
    demo:** Set aside, Ready to assign, Cash you hold, and the Funded, Spent
    and Available columns.
    - *Direction:* a short explanation next to each term, one tap away, plus
      a small glossary.

18. **"Needs your attention" took a moment.** After funding this month, the
    remaining prompt was about next month (November).
    - *Direction:* every alert says which month it is about.

**Too much at once (same cause as notes 2, 4, 6 and 7)**

19. **The navigation menu needs a redesign.**
20. **Every pop-up needs a design pass:** Transfer, Move money, Edit plan,
    Fund my plan and the setup plan step. They are dense forms with little
    guidance.
21. **Record offers too many kinds:** Transfer, Move money, Exchange,
    Investment, Loan and Refund on top of Expense and Income. "It's not UX."
    Same as note 6.

**What worked (keep)**

- The record dialog looks and behaves the same everywhere.
- Opening Record from a plan item (Rent) pre-fills that item.
- Bills: adding, paying, Skip and Undo skip were understood.
- Income: "lands in Ready to assign, then fund your plan" was understood.
- Switching months on Plan.

## Done during the walkthrough

- The local preview database and the browser sign-in were reset, so the
  owner could start over (2026-10-03). This was local only; production was
  not touched.

## Suggested order for a future session

1. **Bugs first (small, one session):** notes 9 and 10, each with a test
   that fails before the fix.
2. **Words (small):** notes 11–18. These are mostly copy and small form
   changes, and they can ship before any redesign.
3. **Simplification design pass:** notes 2, 4, 6, 7 and 19–21 together, as one
   brainstorm and spec. They share one cause, and fixing them one by one
   would give several different patterns. Notes 5 and 8 (the tour) go into
   the same pass.
4. **Note 1 (sign-in)** can be done on its own at any time.
