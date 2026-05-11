const { bot } = require('../bot')
const { BARTENDER_GROUP_ID, OWNER_GROUP_ID, DASHBOARD_URL } = require('../config')
const { tableUserMap } = require('../state')
const { markOrderPaid } = require('../db/orders')
const { supabase } = require('../db/client')

// --------------------
// PAID
// --------------------
bot.action(/^paid/, async (ctx) => {
    const data = ctx.callbackQuery.data
    // format: paid|{table}|{orderId}|{total}
    const parts = data.split('|')
    const table  = parts[1]
    const orderId = parts[2]
    const total  = parseInt(parts[3]) || 0

    console.log(`PAID handler triggered: data=${data}`)
    console.log(`PAID handler: table=${table} orderId=${orderId} total=${total}`)

    await ctx.answerCbQuery('Payment confirmed ✅')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ PAID',
        { reply_markup: { inline_keyboard: [] } }
    ).catch((e) => console.log('editMessageText error:', e.message))

    if (orderId && orderId !== 'null') {
        await markOrderPaid(orderId, total)
        console.log(`Marked order ${orderId} as paid`)
    }

    await bot.telegram.sendMessage(BARTENDER_GROUP_ID, `✅ PAYMENT COMPLETED\n${table} is now closed`)
        .catch(e => console.log('Bartender msg error:', e.message))

    const customerUserId = tableUserMap[table]
    if (customerUserId) {
        await bot.telegram.sendMessage(
            customerUserId,
            `✅ You've paid successfully!\n\nThank you for visiting and hope to see you again! 🍻`
        ).catch(() => {})
        delete tableUserMap[table]
    }

    console.log(`Sending to owner group: ${OWNER_GROUP_ID}`)
    try {
        const today = new Date().toISOString().split('T')[0]
        const { data: todayOrders, error: dbErr } = await supabase
            .from('orders')
            .select('total')
            .eq('status', 'paid')
            .gte('paid_at', `${today}T00:00:00`)

        if (dbErr) console.log('Supabase query error:', dbErr.message)

        const dailyTotal = todayOrders?.reduce((sum, o) => sum + o.total, 0) ?? 0
        console.log(`Daily total: ${dailyTotal}`)

        await bot.telegram.sendMessage(
            OWNER_GROUP_ID,
            `💰 PAYMENT RECEIVED\n\n` +
            `Table: ${table}\n` +
            `Bill: ${total} ETB\n\n` +
            `📊 Today's total so far: ${dailyTotal} ETB`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📊 Open Dashboard', url: DASHBOARD_URL }
                    ]]
                }
            }
        )
        console.log('Owner group message sent successfully')
    } catch (e) {
        console.log('Owner group error:', e.message)
    }
})

// --------------------
// ORDER STATUS
// --------------------
bot.action(/^status_/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const parts = data.split('_')
    const action = parts[1]
    const idParts = parts.slice(2).join('_')
    const staffLabel = idParts.startsWith('W') ? 'Waitress' : 'Bartender'

    const statusMap = {
        received:   { text: '👀 Received',    answer: 'Marked as received!' },
        inprogress: { text: '🔄 In progress', answer: 'Marked as in progress!' },
        served:     { text: '✅ Served',      answer: 'Marked as served!' }
    }

    const status = statusMap[action]
    if (!status) return ctx.answerCbQuery('Unknown status')
    await ctx.answerCbQuery(status.answer)

    if (action === 'served') {
        const userMatch = idParts.match(/U(\d+)/)
        if (userMatch) {
            const userId = userMatch[1]
            await bot.telegram.sendMessage(
                userId,
                `🍺 Your order is on its way!\n\nSit tight, your ${staffLabel.toLowerCase()} is bringing it to you now.`
            ).catch(() => {})
        }
    }

    const originalText = ctx.callbackQuery.message.text
    const cleanText = originalText.replace(/\n\nStatus:.*$/s, '')
    const statusLine = `\n\nStatus: ${status.text} (${staffLabel})`

    await ctx.editMessageText(cleanText + statusLine, {
        reply_markup: {
            inline_keyboard: [[
                { text: '👀 Received',    callback_data: `status_received_${idParts}` },
                { text: '🔄 In progress', callback_data: `status_inprogress_${idParts}` },
                { text: '✅ Served',      callback_data: `status_served_${idParts}` }
            ]]
        }
    }).catch(() => {})
})

// --------------------
// WAITER ACKNOWLEDGEMENT
// --------------------
bot.action(/^waiter_ack_/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const userMatch = data.match(/U(\d+)/)

    await ctx.answerCbQuery('On my way! ✅')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ Waitress is on the way!',
        { reply_markup: { inline_keyboard: [] } }
    ).catch(() => {})

    if (userMatch) {
        await bot.telegram.sendMessage(
            userMatch[1],
            `✅ Your waiter is on the way!\n\nSomeone will be with you in a moment. 🙂`
        ).catch(() => {})
    }
})

// --------------------
// CATCH-ALL CALLBACK (debug — remove before production)
// --------------------
bot.on('callback_query', async (ctx) => {
    console.log('RAW CALLBACK:', ctx.callbackQuery.data)
    await ctx.answerCbQuery().catch(() => {})
})
