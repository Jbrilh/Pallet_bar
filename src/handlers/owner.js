const { bot } = require('../bot')
const {
    BARTENDER_GROUP_ID,
    OWNER_GROUP_ID,
    WAITRESS_1_GROUP_ID,
    WAITRESS_2_GROUP_ID,
    AUTHORIZED_GROUPS,
    DASHBOARD_URL
} = require('../config')
const { state, activeCustomers, resetOrderCounter } = require('../state')
const { supabase } = require('../db/client')

// --------------------
// CLOSING SUMMARY
// --------------------
async function sendClosingSummary() {
    const today = new Date().toISOString().split('T')[0]

    const { data: orders } = await supabase
        .from('orders')
        .select('id, table_name, customer, total')
        .eq('status', 'paid')
        .gte('paid_at', `${today}T00:00:00`)

    if (!orders || !orders.length) {
        const msg = `🔒 BAR CLOSED\n\nNo orders recorded today.`
        await bot.telegram.sendMessage(OWNER_GROUP_ID, msg).catch(() => {})
        await bot.telegram.sendMessage(BARTENDER_GROUP_ID, msg).catch(() => {})
        return
    }

    const orderIds = orders.map(o => o.id)
    const { data: items } = await supabase
        .from('order_items')
        .select('item_name, qty, price')
        .in('order_id', orderIds)

    const totalRevenue = orders.reduce((s, o) => s + o.total, 0)

    const itemMap = {}
    for (const i of items || []) {
        if (!itemMap[i.item_name]) itemMap[i.item_name] = { qty: 0, revenue: 0 }
        itemMap[i.item_name].qty += i.qty
        itemMap[i.item_name].revenue += i.qty * i.price
    }
    const itemLines = Object.entries(itemMap)
        .sort((a, b) => b[1].qty - a[1].qty)
        .map(([name, d]) => `  - ${name}: ${d.qty} sold (${d.revenue.toLocaleString()} ETB)`)
        .join('\n')

    const tableLines = orders
        .sort((a, b) => b.total - a.total)
        .map(o => `  - ${o.table_name} (${o.customer || 'Guest'}): ${o.total.toLocaleString()} ETB`)
        .join('\n')

    const summary =
        `🔒 BAR CLOSED — Daily Summary\n\n` +
        `📅 ${new Date().toLocaleDateString('en-ET', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n` +
        `💰 Total Revenue: ${totalRevenue.toLocaleString()} ETB\n` +
        `🪑 Tables Served: ${orders.length}\n\n` +
        `📦 Items Sold:\n${itemLines}\n\n` +
        `🪑 Per-Table:\n${tableLines}`

    await bot.telegram.sendMessage(OWNER_GROUP_ID, summary).catch(() => {})
    await bot.telegram.sendMessage(BARTENDER_GROUP_ID, summary).catch(() => {})

    const waitressGroups = [
        { id: WAITRESS_1_GROUP_ID, tables: ['Table 1', 'Table 2', 'Table 3'], name: 'Waitress 1' },
        { id: WAITRESS_2_GROUP_ID, tables: ['Table 4', 'Table 5', 'Table 6'], name: 'Waitress 2' }
    ]

    for (const w of waitressGroups) {
        const wOrders = orders.filter(o => w.tables.includes(o.table_name))
        if (!wOrders.length) {
            await bot.telegram.sendMessage(w.id,
                `🔒 Shift ended — no tables served tonight. Rest well! 💤`
            ).catch(() => {})
            continue
        }

        const wRevenue = wOrders.reduce((s, o) => s + o.total, 0)
        const wTableLines = wOrders.map(o =>
            `  - ${o.table_name} (${o.customer || 'Guest'}): ${o.total.toLocaleString()} ETB`
        ).join('\n')

        const wOrderIds = wOrders.map(o => o.id)
        const { data: wItems } = await supabase
            .from('order_items')
            .select('item_name, qty')
            .in('order_id', wOrderIds)
            .in('category', ['Beers 🍺', 'Soft Drinks 🥤'])

        const wItemMap = {}
        for (const i of wItems || []) {
            wItemMap[i.item_name] = (wItemMap[i.item_name] || 0) + i.qty
        }
        const wItemLines = Object.entries(wItemMap)
            .sort((a, b) => b[1] - a[1])
            .map(([name, qty]) => `  - ${name}: ${qty}`)
            .join('\n')

        const wSummary =
            `🔒 SHIFT SUMMARY — ${w.name}\n\n` +
            `🪑 Tables served: ${wOrders.length}\n` +
            `💰 Revenue from your tables: ${wRevenue.toLocaleString()} ETB\n\n` +
            `📦 Items you served:\n${wItemLines || '  None'}\n\n` +
            `🪑 Your tables:\n${wTableLines}\n\n` +
            `Great work tonight! 🙌`

        await bot.telegram.sendMessage(w.id, wSummary).catch(() => {})
    }

    resetOrderCounter()
}

// --------------------
// OPEN
// --------------------
bot.command('open', async (ctx) => {
    if (!AUTHORIZED_GROUPS.includes(ctx.chat.id)) return

    if (state.barIsOpen) {
        return ctx.reply('✅ Bar is already open!')
    }

    state.barIsOpen = true
    await bot.telegram.sendMessage(OWNER_GROUP_ID, '✅ BAR IS NOW OPEN\n\nCustomers can start ordering 🍻').catch(() => {})
    await bot.telegram.sendMessage(BARTENDER_GROUP_ID, '✅ BAR IS NOW OPEN\n\nCustomers can start ordering 🍻').catch(() => {})
})

// --------------------
// CLOSE
// --------------------
bot.command('close', async (ctx) => {
    if (!AUTHORIZED_GROUPS.includes(ctx.chat.id)) return

    if (!state.barIsOpen) {
        return ctx.reply('🚫 Bar is already closed!')
    }

    state.barIsOpen = false
    ctx.reply('🔒 Closing the bar and generating summary...')
    await sendClosingSummary()
})

// --------------------
// SPECIAL OFFERS BROADCAST
// --------------------
bot.command('offer', async (ctx) => {
    if (ctx.chat.id !== OWNER_GROUP_ID) return

    const offerText = ctx.message.text.replace('/offer', '').trim()
    if (!offerText) {
        return ctx.reply('Please add a message after /offer\nExample: /offer Happy Hour! 50% off all beers until 8pm 🍺')
    }

    if (!activeCustomers.size) {
        return ctx.reply('No active customers right now to send the offer to.')
    }

    let sent = 0
    for (const userId of activeCustomers) {
        await bot.telegram.sendMessage(userId, `🎉 SPECIAL OFFER\n\n${offerText}`).catch(() => {})
        sent++
    }

    ctx.reply(`✅ Offer sent to ${sent} active customer${sent !== 1 ? 's' : ''}!`)
})

// --------------------
// DASHBOARD
// --------------------
bot.command('dashboard', (ctx) => {
    if (ctx.chat.id !== OWNER_GROUP_ID) return
    ctx.reply(
        `📊 *Bar Dashboard*\n\nTap below to open the owner dashboard:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📊 Open Dashboard', url: DASHBOARD_URL }
                ]]
            }
        }
    )
})
