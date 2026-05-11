const { Telegraf, session } = require('telegraf')

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.use(session({
    defaultSession: () => ({
        table: null,
        cart: [],
        tab: [],
        orderId: null,
        userId: null,
        step: 'idle',
        activeCategory: null,
        isStaffOrder: false,
        customerName: null
    })
}))

module.exports = { bot }
