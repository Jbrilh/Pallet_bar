const { Markup } = require('telegraf')
const { bot } = require('../bot')
const { state, tableUserMap, activeCustomers } = require('../state')
const { categories, ITEM_MAP } = require('../menu')
const { tableKeyboard, buildMainMenu, buildCategoryMenu } = require('../keyboards')
const { BARTENDER_GROUP_ID, STAFF_USER_IDS } = require('../config')
const { createOrder, saveRoundItems } = require('../db/orders')
const { deductStock } = require('../db/stock')
const { sendOrderNotifications } = require('../utils/notifications')
const { getWaitressGroup } = require('../utils/routing')

const getCustomerName = ctx => getCustomerName(ctx)

function resetSession(ctx) {
    if (ctx.session.table) delete tableUserMap[ctx.session.table]
    if (ctx.session.userId) activeCustomers.delete(ctx.session.userId)
    ctx.session.table = null
    ctx.session.cart = []
    ctx.session.tab = []
    ctx.session.orderId = null
    ctx.session.userId = null
    ctx.session.step = 'idle'
    ctx.session.activeCategory = null
    ctx.session.isStaffOrder = false
    ctx.session.customerName = null
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
// START
// --------------------
bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return
    resetSession(ctx)

    if (STAFF_USER_IDS.includes(ctx.from.id)) {
        if (!state.barIsOpen) {
            return ctx.reply('🚫 The bar is currently closed.')
        }
        return ctx.reply(
            '👨‍🍳 Staff Mode\n\nPlace an order on behalf of a walk-in customer.',
            Markup.inlineKeyboard([
                Markup.button.callback('📋 New Walk-in Order', 'STAFF_ORDER')
            ])
        )
    }

    if (!state.barIsOpen) {
        return ctx.reply(`🚫 The bar is currently closed.\n\nCome back soon! 🍻`)
    }

    ctx.reply(
        `🍻 Welcome!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([
            Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
        ])
    )
})

// --------------------
// START_ORDER (customer)
// --------------------
bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery()

    if (!state.barIsOpen) {
        return ctx.reply(`🚫 The bar is currently closed. Come back soon! 🍻`)
    }

    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', tableKeyboard)
})

// --------------------
// STAFF_ORDER (walk-in)
// --------------------
bot.action('STAFF_ORDER', async (ctx) => {
    await ctx.answerCbQuery()

    if (!state.barIsOpen) {
        return ctx.reply('🚫 The bar is currently closed.')
    }

    ctx.session.isStaffOrder = true
    ctx.session.customerName = 'Walk-in'
    ctx.session.step = 'selecting_table'
    ctx.reply('Select the table for this walk-in customer:', tableKeyboard)
})

// --------------------
// TABLE SELECTION
// --------------------
bot.hears(/^Table \d+$/, async (ctx) => {
    if (ctx.session.step !== 'selecting_table') {
        return ctx.reply('⚠️ You already have a table. Use the menu below.', buildMainMenu())
    }
    const table = ctx.match[0]
    const customer = getCustomerName(ctx)

    const orderId = await createOrder(table, customer)
    ctx.session.orderId = orderId
    ctx.session.table = table
    ctx.session.userId = ctx.from.id
    ctx.session.step = 'ordering'

    if (!ctx.session.isStaffOrder) {
        tableUserMap[table] = ctx.from.id
        activeCustomers.add(ctx.from.id)
    }

    const label = ctx.session.isStaffOrder
        ? `✅ Walk-in order started for ${table}. Add items below.`
        : `✅ You are at ${table}. What would you like to order?`

    ctx.reply(label, buildMainMenu())
})

// --------------------
// CATEGORY NAVIGATION
// --------------------
const categoryNames = categories.map(c => c.name)

bot.hears(categoryNames, (ctx) => {
    if (!requireTable(ctx)) return
    const categoryName = ctx.message.text
    ctx.session.activeCategory = categoryName
    ctx.session.step = 'browsing_category'
    ctx.reply(`${categoryName}\n\nChoose an item:`, buildCategoryMenu(categoryName))
})

bot.hears('⬅️ Back to Menu', (ctx) => {
    ctx.session.activeCategory = null
    ctx.session.step = 'ordering'
    ctx.reply('What else would you like?', buildMainMenu())
})

// --------------------
// ADD TO CART
// --------------------
bot.hears(/^(.+) — \d+ ETB$/, (ctx) => {
    if (!requireTable(ctx)) return
    const itemName = ctx.match[1]
    const item = ITEM_MAP[itemName]
    if (!item) return ctx.reply('Item not found ❌', buildMainMenu())
    const cart = ctx.session.cart
    const existing = cart.find(i => i.name === item.name)
    if (existing) {
        existing.qty += 1
    } else {
        cart.push({ name: item.name, price: item.price, qty: 1 })
    }
    ctx.reply(
        `✅ ${item.name} added to cart!\n\nAdd more or go back to the menu.`,
        buildCategoryMenu(ctx.session.activeCategory)
    )
})

// --------------------
// VIEW CART
// --------------------
bot.hears('🛒 View Cart', (ctx) => {
    if (!requireTable(ctx)) return
    const cart = ctx.session.cart
    if (!cart.length) return ctx.reply('Your cart is empty 🛒', buildMainMenu())
    const lines = cart.map(i => `• ${i.name} x ${i.qty} = ${i.price * i.qty} ETB`)
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
    ctx.reply(
        `🛒 Your Cart:\n\n${lines.join('\n')}\n\nTotal: ${total} ETB`,
        buildMainMenu()
    )
})

// --------------------
// CLEAR CART
// --------------------
bot.hears('🗑 Clear Cart', (ctx) => {
    if (!requireTable(ctx)) return
    ctx.session.cart = []
    ctx.reply('Cart cleared 🗑', buildMainMenu())
})

// --------------------
// CHECKOUT
// --------------------
bot.hears('✅ Checkout', async (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table, orderId } = ctx.session
    const customer = getCustomerName(ctx)
    if (!cart.length) return ctx.reply('Your cart is empty ❌', buildMainMenu())

    const roundNumber = ctx.session.tab.length + 1
    ctx.session.tab.push({ round: roundNumber, items: [...cart] })
    ctx.session.cart = []

    if (orderId) await saveRoundItems(orderId, roundNumber, cart)
    await deductStock(cart)

    // Pass null as userId for staff orders so no "served" notification is sent to staff
    const notifyUserId = ctx.session.isStaffOrder ? null : ctx.session.userId
    await sendOrderNotifications(table, customer, roundNumber, cart, notifyUserId)

    ctx.reply(
        `✅ Round ${roundNumber} sent!\n\nKeep ordering or request the bill when ready.`,
        buildMainMenu()
    )
})

// --------------------
// REQUEST BILL
// --------------------
bot.hears('🧾 Request Bill', (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table, orderId } = ctx.session
    const customer = getCustomerName(ctx)
    const tab = ctx.session.tab
    const hasAnything = tab.length > 0 || cart.length > 0
    if (!hasAnything) return ctx.reply('No items on tab yet ❌', buildMainMenu())

    const allRounds = [...tab]
    if (cart.length > 0) {
        allRounds.push({ round: tab.length + 1, items: cart, pending: true })
    }

    let total = 0
    const breakdown = allRounds.map(round => {
        const roundLines = round.items.map(i => {
            const lineTotal = i.price * i.qty
            total += lineTotal
            return `    - ${i.name} x ${i.qty} = ${lineTotal} ETB`
        }).join('\n')
        const label = round.pending ? `Round ${round.round} (pending)` : `Round ${round.round}`
        return `${label}:\n${roundLines}`
    }).join('\n\n')

    const billText =
        `🧾 FINAL BILL\n\n` +
        `Table: ${table}\n` +
        `Customer: ${customer}\n\n` +
        `${breakdown}\n\n` +
        `💰 TOTAL: ${total} ETB`

    bot.telegram.sendMessage(BARTENDER_GROUP_ID, billText, {
        reply_markup: {
            inline_keyboard: [[{
                text: '💰 PAID',
                callback_data: `paid|${table}|${orderId}|${total}`
            }]]
        }
    })

    ctx.reply(
        `🧾 Bill sent to the bartender.\n\n${breakdown}\n\n💰 Total: ${total} ETB`,
        buildMainMenu()
    )
})

// --------------------
// CALL WAITER
// --------------------
bot.hears('🆘 Call Waiter', async (ctx) => {
    if (!requireTable(ctx)) return

    const { table } = ctx.session
    const customer = getCustomerName(ctx)
    const waitressGroup = getWaitressGroup(table)
    const callId = `call_${table.replace(' ', '')}_${Date.now()}`

    await bot.telegram.sendMessage(
        waitressGroup,
        `🆘 WAITER NEEDED\n\nTable: ${table}\nCustomer: ${customer}\n\nPlease attend to this table!`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ On my way!', callback_data: `waiter_ack_${callId}_U${ctx.from.id}` }
                ]]
            }
        }
    )

    ctx.reply('🆘 Waiter has been called! Someone will be with you shortly.', buildMainMenu())
})
