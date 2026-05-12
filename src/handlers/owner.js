const { bot } = require('../bot')
const { DASHBOARD_URL } = require('../config')
const { getBarByChatId, getBarConfig, invalidateCache } = require('../db/barConfig')
const { getActiveCustomers, resetOrderCounter } = require('../state')
const { getGroupByType } = require('../utils/routing')
const { supabase } = require('../db/client')

async function setBarOpen(barId, isOpen) {
    const { error } = await supabase
        .from('bars')
        .update({ is_open: isOpen })
        .eq('id', barId)
    if (error) console.error('setBarOpen error:', error)
    invalidateCache(barId)
}

async function sendClosingSummary(barId, config) {
    const today = new Date().toISOString().split('T')[0]

    const { data: orders } = await supabase
        .from('orders')
        .select('id, table_name, customer, total')
        .eq('bar_id', barId)
        .eq('status', 'paid')
        .gte('paid_at', `${today}T00:00:00`)

    const ownerGroup     = getGroupByType('owner', config)
    const bartenderGroup = getGroupByType('bartender', config)
    const waitressGroups = config.groups.filter(g => g.type === 'waitress')

    if (!orders || !orders.length) {
        const msg = `🔒 BAR CLOSED\n\nNo orders recorded today.`
        if (ownerGroup)     await bot.telegram.sendMessage(ownerGroup.chat_id, msg).catch(() => {})
        if (bartenderGroup) await bot.telegram.sendMessage(bartenderGroup.chat_id, msg).catch(() => {})
        return
    }

    const orderIds = orders.map(o => o.id)
    const { data: items } = await supabase
        .from('order_items')
        .select('item_name, qty, price')
        .in('order_id', orderIds)

    const totalRevenue = orders.reduce((s, o) => s + o.total, 0)

    const itemTotals = {}
    for (const i of items || []) {
        if (!itemTotals[i.item_name]) itemTotals[i.item_name] = { qty: 0, revenue: 0 }
        itemTotals[i.item_name].qty += i.qty
        itemTotals[i.item_name].revenue += i.qty * i.price
    }
    const itemLines = Object.entries(itemTotals)
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

    if (ownerGroup)     await bot.telegram.sendMessage(ownerGroup.chat_id, summary).catch(() => {})
    if (bartenderGroup) await bot.telegram.sendMessage(bartenderGroup.chat_id, summary).catch(() => {})

    for (const wGroup of waitressGroups) {
        const wTableNames = config.tables
            .filter(t => t.group_id === wGroup.id)
            .map(t => t.table_name)
        const wOrders = orders.filter(o => wTableNames.includes(o.table_name))

        if (!wOrders.length) {
            await bot.telegram.sendMessage(wGroup.chat_id,
                `🔒 Shift ended — no tables served tonight. Rest well! 💤`
            ).catch(() => {})
            continue
        }

        const wRevenue = wOrders.reduce((s, o) => s + o.total, 0)
        const wTableLines = wOrders
            .map(o => `  - ${o.table_name} (${o.customer || 'Guest'}): ${o.total.toLocaleString()} ETB`)
            .join('\n')

        const { data: wItems } = await supabase
            .from('order_items')
            .select('item_name, qty')
            .in('order_id', wOrders.map(o => o.id))

        const wItemMap = {}
        for (const i of wItems || []) wItemMap[i.item_name] = (wItemMap[i.item_name] || 0) + i.qty
        const wItemLines = Object.entries(wItemMap)
            .sort((a, b) => b[1] - a[1])
            .map(([name, qty]) => `  - ${name}: ${qty}`)
            .join('\n')

        await bot.telegram.sendMessage(wGroup.chat_id,
            `🔒 SHIFT SUMMARY — ${wGroup.label}\n\n` +
            `🪑 Tables served: ${wOrders.length}\n` +
            `💰 Revenue from your tables: ${wRevenue.toLocaleString()} ETB\n\n` +
            `📦 Items you served:\n${wItemLines || '  None'}\n\n` +
            `🪑 Your tables:\n${wTableLines}\n\n` +
            `Great work tonight! 🙌`
        ).catch(() => {})
    }

    resetOrderCounter(barId)
}

// --------------------
// OPEN
// --------------------
bot.command('open', async (ctx) => {
    if (ctx.chat.type === 'private') return
    const barId = await getBarByChatId(ctx.chat.id)
    if (!barId) return

    const config = await getBarConfig(barId)
    if (config.bar.is_open) return ctx.reply('✅ Bar is already open!')

    await setBarOpen(barId, true)

    const msg = '✅ BAR IS NOW OPEN\n\nCustomers can start ordering 🍻'
    for (const g of config.groups) {
        await bot.telegram.sendMessage(g.chat_id, msg).catch(() => {})
    }
})

// --------------------
// CLOSE
// --------------------
bot.command('close', async (ctx) => {
    if (ctx.chat.type === 'private') return
    const barId = await getBarByChatId(ctx.chat.id)
    if (!barId) return

    const config = await getBarConfig(barId)
    if (!config.bar.is_open) return ctx.reply('🚫 Bar is already closed!')

    await setBarOpen(barId, false)
    ctx.reply('🔒 Closing the bar and generating summary...')
    const freshConfig = await getBarConfig(barId)
    await sendClosingSummary(barId, freshConfig)
})

// --------------------
// SPECIAL OFFER BROADCAST
// --------------------
bot.command('offer', async (ctx) => {
    if (ctx.chat.type === 'private') return
    const barId = await getBarByChatId(ctx.chat.id)
    if (!barId) return

    const config = await getBarConfig(barId)
    const ownerGroup = getGroupByType('owner', config)
    if (!ownerGroup || ctx.chat.id !== ownerGroup.chat_id) return

    const offerText = ctx.message.text
        .replace(/^\/offer(@\S+)?/, '')
        .trim()
    if (!offerText) {
        return ctx.reply('Please add a message after /offer\nExample: /offer Happy Hour! 50% off all beers until 8pm 🍺')
    }

    const customers = getActiveCustomers(barId)
    if (!customers.size) return ctx.reply('No active customers right now.')

    let sent = 0
    for (const userId of customers) {
        await bot.telegram.sendMessage(userId, `🎉 SPECIAL OFFER\n\n${offerText}`).catch(() => {})
        sent++
    }
    ctx.reply(`✅ Offer sent to ${sent} active customer${sent !== 1 ? 's' : ''}!`)
})

// --------------------
// DASHBOARD
// --------------------
bot.command('dashboard', async (ctx) => {
    if (ctx.chat.type === 'private') return
    const barId = await getBarByChatId(ctx.chat.id)
    if (!barId) return

    const config = await getBarConfig(barId)
    const ownerGroup = getGroupByType('owner', config)
    if (!ownerGroup || ctx.chat.id !== ownerGroup.chat_id) return

    ctx.reply(
        `📊 *Bar Dashboard*\n\nTap below to open the owner dashboard:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '📊 Open Dashboard', url: DASHBOARD_URL }]]
            }
        }
    )
})

// --------------------
// CHAT ID HELPER
// --------------------
bot.command('chatid', (ctx) => {
    const id = ctx.chat.id
    const type = ctx.chat.type
    if (type === 'private') {
        ctx.reply(`Your Telegram user ID: \`${id}\``, { parse_mode: 'Markdown' })
    } else {
        const title = ctx.chat.title || 'this group'
        ctx.reply(`Chat ID for *${title}*: \`${id}\`\n\nPaste this into the dashboard → Setup tab when adding a group.`, { parse_mode: 'Markdown' })
    }
})
