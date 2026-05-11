const { supabase } = require('./client')
const { ITEM_MAP } = require('../menu')

async function createOrder(table, customer) {
    const { data, error } = await supabase
        .from('orders')
        .insert({ table_name: table, customer, total: 0, status: 'open' })
        .select('id')
        .single()
    if (error) { console.error('createOrder error:', error); return null }
    return data.id
}

async function saveRoundItems(orderId, roundNumber, items) {
    const rows = items.map(i => ({
        order_id: orderId,
        round_number: roundNumber,
        item_name: i.name,
        category: ITEM_MAP[i.name]?.category ?? 'Unknown',
        qty: i.qty,
        price: i.price
    }))
    const { error } = await supabase.from('order_items').insert(rows)
    if (error) console.error('saveRoundItems error:', error)
}

async function markOrderPaid(orderId, total) {
    const { error } = await supabase
        .from('orders')
        .update({ status: 'paid', total, paid_at: new Date().toISOString() })
        .eq('id', orderId)
    if (error) console.error('markOrderPaid error:', error)
}

module.exports = { createOrder, saveRoundItems, markOrderPaid }
