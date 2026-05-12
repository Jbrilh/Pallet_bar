const { bot } = require('../bot')
const { DASHBOARD_URL } = require('../config')
const { getBarByChatId, getBarConfig } = require('../db/barConfig')
const { getTableUserMap } = require('../state')
const { getGroupByType } = require('../utils/routing')
const { markOrderPaid } = require('../db/orders')
const { supabase } = require('../db/client')

// --------------------
// PAID
// --------------------
bot.action(/^paid/, async (ctx) => {
    const data = ctx.callbackQuery.data
    // format: paid|{table}|{orderId}|{total}
    const parts = data.split('|')
    const table   = parts[1]
    const orderId = parts[2]
    const total   = parseInt(parts[3]) || 0

    await ctx.answerCbQuery('Payment confirmed ✅')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ PAID',
        { reply_markup: { inline_keyboard: [] } }
    ).catch(e => console.log('editMessageText error:', e.message))

    if (orderId && orderId !== 'null') await markOrderPaid(orderId, total)

    const barId = await getBarByChatId(ctx.chat.id)
    const config = barId ? await getBarConfig(barId) : null

    const bartenderGroup = config ? getGroupByType('bartender', config) : null
    const ownerGroup     = config ? getGroupByType('owner', config) : null

    if (bartenderGroup) {
        await bot.telegram.sendMessage(bartenderGroup.chat_id, `✅ PAYMENT COMPLETED\n${table} is now closed`)
            .catch(e => console.log('Bartender msg error:', e.message))
    }

    if (barId) {
        const tableUserMap = getTableUserMap(barId)
        const customerUserId = tableUserMap[table]
        if (customerUserId) {
            await bot.telegram.sendMessage(
                customerUserId,
                `✅ You've paid successfully!\n\nThank you for visiting and hope to see you again! 🍻`
            ).catch(() => {})
            delete tableUserMap[table]
        }
    }

    if (ownerGroup && barId) {
        try {
            const today = new Date().toISOString().split('T')[0]
            const { data: todayOrders } = await supabase
                .from('orders')
                .select('total')
                .eq('bar_id', barId)
                .eq('status', 'paid')
                .gte('paid_at', `${today}T00:00:00`)

            const dailyTotal = todayOrders?.reduce((sum, o) => sum + o.total, 0) ?? 0

            await bot.telegram.sendMessage(
                ownerGroup.chat_id,
                `💰 PAYMENT RECEIVED\n\nTable: ${table}\nBill: ${total} ETB\n\n📊 Today's total so far: ${dailyTotal} ETB`,
                {
                    reply_markup: {
                        inline_keyboard: [[{ text: '📊 Open Dashboard', url: DASHBOARD_URL }]]
                    }
                }
            )
        } catch (e) {
            console.log('Owner group error:', e.message)
        }
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
            await bot.telegram.sendMessage(
                userMatch[1],
                `🍺 Your order is on its way!\n\nSit tight, your ${staffLabel.toLowerCase()} is bringing it to you now.`
            ).catch(() => {})
        }
    }

    const cleanText = ctx.callbackQuery.message.text.replace(/\n\nStatus:.*$/s, '')
    await ctx.editMessageText(cleanText + `\n\nStatus: ${status.text} (${staffLabel})`, {
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
    const userMatch = ctx.callbackQuery.data.match(/U(\d+)/)
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
