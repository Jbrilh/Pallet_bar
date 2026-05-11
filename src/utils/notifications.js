const { bot } = require('../bot')
const { BARTENDER_GROUP_ID } = require('../config')
const { nextOrderNumber } = require('../state')
const { splitCart, getWaitressGroup } = require('./routing')
const { formatItems } = require('./formatting')

async function sendOrderNotifications(table, customer, roundNumber, cart, userId) {
    const { waitressItems, bartenderItems } = splitCart(cart)
    const waitressGroup = getWaitressGroup(table)
    const orderNum = nextOrderNumber()
    const orderId = `${table.replace(' ', '')}_R${roundNumber}_U${userId}_${Date.now()}`

    const statusButtons = (id) => ({
        reply_markup: {
            inline_keyboard: [[
                { text: '👀 Received',    callback_data: `status_received_${id}` },
                { text: '🔄 In progress', callback_data: `status_inprogress_${id}` },
                { text: '✅ Served',      callback_data: `status_served_${id}` }
            ]]
        }
    })

    if (waitressItems.length > 0) {
        const text =
            `🛎 ORDER #${orderNum} - Round ${roundNumber}\n\n` +
            `Table: ${table}\n` +
            `Customer: ${customer}\n\n` +
            `Items:\n${formatItems(waitressItems)}`
        await bot.telegram.sendMessage(waitressGroup, text, statusButtons(`W_${orderId}`))
    }

    if (bartenderItems.length > 0) {
        const text =
            `🍾 ORDER #${orderNum} - Round ${roundNumber}\n\n` +
            `Table: ${table}\n` +
            `Customer: ${customer}\n\n` +
            `Items:\n${formatItems(bartenderItems)}`
        await bot.telegram.sendMessage(BARTENDER_GROUP_ID, text, statusButtons(`B_${orderId}`))
    }
}

module.exports = { sendOrderNotifications }
