const { Telegraf, session } = require('telegraf')

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.use(session({
    defaultSession: () => ({
        barId: null,
        table: null,
        cart: [],
        tab: [],
        orderId: null,
        userId: null,
        step: 'idle',
        activeCategoryId: null,
        isStaffOrder: false,
        customerName: null,
        registrationStep: null
    })
}))

module.exports = { bot }
