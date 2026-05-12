const { bot } = require('../bot')
const { nextOrderNumber } = require('../state')
const { splitCartByGroup, getGroupByType } = require('./routing')
const { formatItems } = require('./formatting')

async function sendOrderNotifications(table, customer, roundNumber, cart, userId, config) {
    const byGroup = splitCartByGroup(cart, config)
    const bartenderGroup = getGroupByType('bartender', config)
    const orderNum = nextOrderNumber(config.bar.id)
    const notifId = `${table.replace(/\s/g, '')}_R${roundNumber}_U${userId}_${Date.now()}`

    const statusButtons = (id) => ({
        reply_markup: {
            inline_keyboard: [[
                { text: '👀 Received',    callback_data: `status_received_${id}` },
                { text: '🔄 In progress', callback_data: `status_inprogress_${id}` },
                { text: '✅ Served',      callback_data: `status_served_${id}` }
            ]]
        }
    })

    for (const [groupId, items] of byGroup) {
        let group = groupId ? config.groupMap[groupId] : null
        if (!group) group = bartenderGroup  // unrouted items fall back to bartender
        if (!group) continue

        const prefix = group.type === 'bartender' ? '🍾' : '🛎'
        const id = `${group.type === 'bartender' ? 'B' : 'W'}_${notifId}`
        const text =
            `${prefix} ORDER #${orderNum} - Round ${roundNumber}\n\n` +
            `Table: ${table}\n` +
            `Customer: ${customer}\n\n` +
            `Items:\n${formatItems(items)}`

        await bot.telegram.sendMessage(group.chat_id, text, statusButtons(id))
    }
}

module.exports = { sendOrderNotifications }
