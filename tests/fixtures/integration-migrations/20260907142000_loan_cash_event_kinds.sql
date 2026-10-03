alter type public.financial_event_kind add value if not exists 'loan_lend';
alter type public.financial_event_kind add value if not exists 'loan_borrow';
alter type public.financial_event_kind add value if not exists 'loan_receive_repayment';
alter type public.financial_event_kind add value if not exists 'loan_repay_borrowing';
