require('dotenv').config()
 
const { Telegraf, Markup, session } = require('telegraf')
 
const bot = new Telegraf(process.env.BOT_TOKEN)
 
// --------------------
// GROUP ID
// --------------------
const GROUP_ID = -5098569760
 
// --------------------
// MENU PRICES
// --------------------
const MENU = {
    'Beer 🍺': { name: 'Beer', price: 120 },
    'Whiskey 🥃': { name: 'Whiskey', price: 250 },
    'Soft Drink 🥤': { name: 'Soft Drink', price: 80 }
}
 
// --------------------
// SIMPLE MEMORY STORE (TABLE SESSIONS)
// --------------------
const tableSessions = {}
 
// --------------------
// SESSION
// --------------------
bot.use(session({
    defaultSession: () => ({
        table: null,
        cart: [],
        step: 'idle' // 'idle' | 'selecting_table' | 'ordering'
    })
}))
 
// --------------------
// KEYBOARDS
// --------------------
const tableKeyboard = Markup.keyboard([
    ['Table 1', 'Table 2', 'Table 3'],
    ['Table 4', 'Table 5', 'Table 6']
]).resize().oneTime() // disappears after a table is picked
 
const mainMenu = Markup.keyboard([
    ['Beer 🍺', 'Whiskey 🥃', 'Soft Drink 🥤'],
    ['🛒 View Cart', '🧾 Request Bill'],
    ['🗑 Clear Cart', '✅ Checkout']
]).resize()
 
// --------------------
// HELPERS
// --------------------
function resetSession(ctx) {
    ctx.session.table = null
    ctx.session.cart = []
    ctx.session.step = 'idle'
}
 
function requireTable(ctx) {
    if (!ctx.session.table) {
        ctx.reply(
            '⚠️ Please select your table first.',
            Markup.inlineKeyboard([
                Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
            ])
        )
        return false
    }
    return true
}
 
// --------------------
// START — always resets and prompts fresh
// --------------------
bot.start((ctx) => {
    resetSession(ctx)
    ctx.reply(
        `🍻 Welcome to Bar System!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([
            Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
        ])
    )
})
 
// --------------------
// START_ORDER action — shows table keyboard
// --------------------
bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery() // dismisses the loading spinner on the button
    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', tableKeyboard)
})
 
// --------------------
// TABLE SELECTION — only active when step is 'selecting_table'
// --------------------
bot.hears(/^Table \d+$/, (ctx) => {
    // Ignore if the user wasn't in table-selection step
    if (ctx.session.step !== 'selecting_table') {
        return ctx.reply(
            '⚠️ You already have a table assigned. Use the menu below.',
            mainMenu
        )
    }
 
    const table = ctx.match[0]
    ctx.session.table = table
    ctx.session.step = 'ordering'
    tableSessions[table] = ctx.session
 
    ctx.reply(`✅ You are at ${table}. What would you like to order?`, mainMenu)
})
 
// --------------------
// ADD TO CART
// --------------------
function addToCart(ctx, key) {
    if (!requireTable(ctx)) return
 
    const item = MENU[key]
    const cart = ctx.session.cart
    const existing = cart.find(i => i.name === item.name)
 
    if (existing) {
        existing.qty += 1
    } else {
        cart.push({ name: item.name, price: item.price, qty: 1 })
    }
 
    ctx.reply(`✅ ${item.name} added to cart 🛒`, mainMenu)
}
 
bot.hears('Beer 🍺', (ctx) => addToCart(ctx, 'Beer 🍺'))
bot.hears('Whiskey 🥃', (ctx) => addToCart(ctx, 'Whiskey 🥃'))
bot.hears('Soft Drink 🥤', (ctx) => addToCart(ctx, 'Soft Drink 🥤'))
 
// --------------------
// VIEW CART
// --------------------
bot.hears('🛒 View Cart', (ctx) => {
    if (!requireTable(ctx)) return
 
    const cart = ctx.session.cart
    if (!cart.length) return ctx.reply('Your cart is empty 🛒', mainMenu)
 
    const text = cart.map(i => `• ${i.name} × ${i.qty} = ${i.price * i.qty} ETB`).join('\n')
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
 
    ctx.reply(`🛒 *Your Tab:*\n\n${text}\n\n_Subtotal: ${total} ETB_`, {
        parse_mode: 'Markdown',
        ...mainMenu
    })
})
 
// --------------------
// CLEAR CART
// --------------------
bot.hears('🗑 Clear Cart', (ctx) => {
    if (!requireTable(ctx)) return
    ctx.session.cart = []
    ctx.reply('Cart cleared 🗑', mainMenu)
})
 
// --------------------
// CHECKOUT (send tab to bartender)
// --------------------
bot.hears('✅ Checkout', (ctx) => {
    if (!requireTable(ctx)) return
 
    const { cart, table } = ctx.session
    const customer = ctx.from.first_name
 
    if (!cart.length) return ctx.reply('Your cart is empty ❌', mainMenu)
 
    const itemsText = cart.map(i => `  - ${i.name} × ${i.qty}`).join('\n')
    const orderText =
        `🧾 TAB UPDATED\n\n` +
        `Table: ${table}\n` +
        `Customer: ${customer}\n\n` +
        `Items:\n${itemsText}\n\n` +
        `⏳ Running tab active`
 
    bot.telegram.sendMessage(GROUP_ID, orderText)
    ctx.reply('Order sent to bar! Added to your tab 🧾', mainMenu)
})
 
// --------------------
// REQUEST BILL
// --------------------
bot.hears('🧾 Request Bill', (ctx) => {
    if (!requireTable(ctx)) return
 
    const { cart, table } = ctx.session
    const customer = ctx.from.first_name
 
    if (!cart.length) return ctx.reply('No items on tab yet ❌', mainMenu)
 
    let total = 0
    const breakdown = cart.map(i => {
        const lineTotal = i.price * i.qty
        total += lineTotal
        return `  - ${i.name} × ${i.qty} = ${lineTotal} ETB`
    }).join('\n')
 
    const billText =
        `🧾 FINAL BILL\n\n` +
        `Table: ${table}\n` +
        `Customer: ${customer}\n\n` +
        `Items:\n${breakdown}\n\n` +
        `💰 TOTAL: ${total} ETB`
 
    bot.telegram.sendMessage(GROUP_ID, billText, {
        reply_markup: {
            inline_keyboard: [[{ text: '💰 PAID', callback_data: `paid_${table}` }]]
        }
    })
 
    ctx.reply(`💰 Bill requested! Total: ${total} ETB\nThe bartender will confirm your payment.`)
})
 
// --------------------
// PAID BUTTON HANDLER (bartender side)
// --------------------
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data
 
    if (data === 'START_ORDER') return // already handled by bot.action above
 
    if (data.startsWith('paid_')) {
        const table = data.replace('paid_', '')
 
        if (tableSessions[table]) {
            tableSessions[table].cart = []
            tableSessions[table].table = null
            tableSessions[table].step = 'idle'
        }
 
        await ctx.answerCbQuery('Payment confirmed ✅')
 
        bot.telegram.sendMessage(
            GROUP_ID,
            `✅ PAYMENT COMPLETED\n${table} is now closed`
        )
    }
})
 
// --------------------
// LAUNCH
// --------------------
bot.launch()
console.log('🍻 Bar POS Bot Running...')
 
// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))