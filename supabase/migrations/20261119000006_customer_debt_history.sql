-- Lịch sử nợ của một khách (gồm khách đã gộp vào): đơn ghi nợ kèm ngày + món, và các lần trả.
-- Tablet được đọc (màn Thu nợ cần biết nợ ngày nào, món gì) dù RLS không cho tablet đọc đơn đã thanh toán.
create function public.customer_debt_history(p_customer uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with recursive tree as (
    select id from public.customers where id = p_customer
    union
    select c.id from public.customers c join tree t on c.merged_into_id = t.id
  )
  select case when private.is_tablet() or private.is_owner() then jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'code', o.code, 'paid_at', o.paid_at, 'total', o.total,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'name', i.name_snap, 'qty', i.qty,
                          'toppings', (select coalesce(jsonb_agg(t ->> 'name'), '[]'::jsonb)
                                         from jsonb_array_elements(i.toppings_snap) t))
                        order by i.sort)
                   from public.order_items i
                  where i.order_id = o.id and i.removed_at is null), '[]'::jsonb))
             order by o.paid_at)
        from public.orders o
       where o.status = 'paid' and o.payment_method = 'debt' and o.customer_id in (select id from tree)), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'at', p.at, 'amount', p.amount, 'method', p.method) order by p.at)
        from public.debt_payments p
       where p.customer_id in (select id from tree)), '[]'::jsonb))
  end
$$;

revoke execute on function public.customer_debt_history(uuid) from public, anon;
grant execute on function public.customer_debt_history(uuid) to authenticated;
