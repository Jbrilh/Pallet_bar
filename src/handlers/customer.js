const { Markup } = require('telegraf')
const { bot } = require('../bot')
const { getTableUserMap, getActiveCustomers } = require('../state')
const { getBarConfig, getBarByCode } = require('../db/barConfig')
const { buildTableKeyboard, buildMainMenu, buildCategoryMenu } = require('../keyboards')
const { createOrder, saveRoundItems } = require('../db/orders')
const { deductStock } = require('../db/stock')
const { sendOrderNotifications } = require('../utils/notifications')
const { getGroupByType, getTableGroup } = require('../utils/routing')

const getCustomerName = ctx => ctx.session.customerName || ctx.from.first_name

function resetSession(ctx) {
    if (ctx.session.barId && ctx.session.table) {
        delete getTableUserMap(ctx.session.barId)[ctx.session.table]
    }
    if (ctx.session.barId && ctx.session.userId) {
        getActiveCustomers(ctx.session.barId).delete(ctx.session.userId)
    }
    ctx.session.barId = null
    ctx.session.table = null
    ctx.session.cart = []
    ctx.session.tab = []
    ctx.session.orderId = null
    ctx.session.userId = null
    ctx.session.step = 'idle'
    ctx.session.activeCategoryId = null
    ctx.session.isStaffOrder = false
    ctx.session.customerName = null
}

function requireTable(ctx) {
    if (!ctx.session.table) {
        ctx.reply(
            '⚠️ Please select your table first.',
            Markup.inlineKeyboard([Markup.button.callback('🍺 Start Ordering', 'START_ORDER')])
        )
        return false
    }
    return true
}

async function requireConfig(ctx) {
    if (!ctx.session.barId) {
        ctx.reply('⚠️ Please scan your bar\'s QR code to start ordering.')
        return null
    }
    return getBarConfig(ctx.session.barId)
}

// --------------------
// START
// --------------------
bot.start(async (ctx) => {
    if (ctx.chat.type !== 'private') return

    resetSession(ctx)

    const payload = ctx.startPayload
    if (!payload || !payload.startsWith('bar_')) {
        return ctx.reply(
            '⚠️ Please scan your bar\'s QR code to start ordering.\n\n' +
            'Are you a bar owner? Use /register to set up your bar.'
        )
    }

    const code = payload.replace('bar_', '')
    const bar = await getBarByCode(code)
    if (!bar || bar.status !== 'approved') {
        return ctx.reply('⚠️ Invalid or inactive QR code. Please contact bar staff.')
    }

    ctx.session.barId = bar.id
    const config = await getBarConfig(bar.id)

    if (config.staffIds.includes(ctx.from.id)) {
        if (!config.bar.is_open) return ctx.reply('🚫 The bar is currently closed.')
        return ctx.reply(
            '👨‍🍳 Staff Mode\n\nPlace an order on behalf of a walk-in customer.',
            Markup.inlineKeyboard([Markup.button.callback('📋 New Walk-in Order', 'STAFF_ORDER')])
        )
    }

    if (!config.bar.is_open) return ctx.reply('🚫 The bar is currently closed.\n\nCome back soon! 🍻')

    ctx.reply(
        `🍻 Welcome to ${config.bar.name}!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([Markup.button.callback('🍺 Start Ordering', 'START_ORDER')])
    )
})

// --------------------
// START_ORDER
// --------------------
bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery()
    const config = await requireConfig(ctx)
    if (!config) return
    if (!config.bar.is_open) return ctx.reply('🚫 The bar is currently closed. Come back soon! 🍻')
    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', buildTableKeyboard(config))
})

// --------------------
// STAFF_ORDER (walk-in)
// --------------------
bot.action('STAFF_ORDER', async (ctx) => {
    await ctx.answerCbQuery()
    const config = await requireConfig(ctx)
    if (!config) return
    if (!config.bar.is_open) return ctx.reply('🚫 The bar is currently closed.')
    ctx.session.isStaffOrder = true
    ctx.session.customerName = 'Walk-in'
    ctx.session.step = 'selecting_table'
    ctx.reply('Select the table for this walk-in customer:', buildTableKeyboard(config))
})

// --------------------
// VIEW CART
// --------------------
bot.hears('🛒 View Cart', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    const cart = ctx.session.cart
    if (!cart.length) return ctx.reply('Your cart is empty 🛒', buildMainMenu(config))
    const lines = cart.map(i => `• ${i.name} x ${i.qty} = ${i.price * i.qty} ETB`)
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
    ctx.reply(`🛒 Your Cart:\n\n${lines.join('\n')}\n\nTotal: ${total} ETB`, buildMainMenu(config))
})

// --------------------
// CLEAR CART
// --------------------
bot.hears('🗑 Clear Cart', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    ctx.session.cart = []
    ctx.reply('Cart cleared 🗑', buildMainMenu(config))
})

// --------------------
// BACK TO MENU
// --------------------
bot.hears('⬅️ Back to Menu', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    const config = await requireConfig(ctx)
    if (!config) return
    ctx.session.activeCategoryId = null
    ctx.session.step = 'ordering'
    ctx.reply('What else would you like?', buildMainMenu(config))
})

// --------------------
// ADD TO CART (item button pattern: "Name — 150 ETB")
// --------------------
bot.hears(/^(.+) — \d+ ETB$/, async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    const itemName = ctx.match[1]
    const item = config.itemMap[itemName]
    if (!item) return ctx.reply('Item not found ❌', buildMainMenu(config))
    const cart = ctx.session.cart
    const existing = cart.find(i => i.name === item.name)
    if (existing) {
        existing.qty += 1
    } else {
        cart.push({ name: item.name, price: item.price, qty: 1, categoryName: item.categoryName })
    }
    ctx.reply(
        `✅ ${item.name} added to cart!\n\nAdd more or go back to the menu.`,
        buildCategoryMenu(ctx.session.activeCategoryId, config)
    )
})

// --------------------
// CHECKOUT
// --------------------
bot.hears('✅ Checkout', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    const { cart, table, orderId } = ctx.session
    const customer = getCustomerName(ctx)
    if (!cart.length) return ctx.reply('Your cart is empty ❌', buildMainMenu(config))

    const roundNumber = ctx.session.tab.length + 1
    ctx.session.tab.push({ round: roundNumber, items: [...cart] })
    ctx.session.cart = []

    if (orderId) await saveRoundItems(orderId, config.bar.id, roundNumber, cart)

    const ownerGroup = getGroupByType('owner', config)
    await deductStock(config.bar.id, cart, ownerGroup?.chat_id)

    const notifyUserId = ctx.session.isStaffOrder ? null : ctx.session.userId
    await sendOrderNotifications(table, customer, roundNumber, cart, notifyUserId, config)

    ctx.reply(
        `✅ Round ${roundNumber} sent!\n\nKeep ordering or request the bill when ready.`,
        buildMainMenu(config)
    )
})

// --------------------
// REQUEST BILL
// --------------------
bot.hears('🧾 Request Bill', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    const { cart, table, orderId } = ctx.session
    const customer = getCustomerName(ctx)
    const tab = ctx.session.tab
    if (!tab.length && !cart.length) return ctx.reply('No items on tab yet ❌', buildMainMenu(config))

    const allRounds = [...tab]
    if (cart.length > 0) allRounds.push({ round: tab.length + 1, items: cart, pending: true })

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

    const bartenderGroup = getGroupByType('bartender', config)
    if (bartenderGroup) {
        await bot.telegram.sendMessage(bartenderGroup.chat_id, billText, {
            reply_markup: {
                inline_keyboard: [[{
                    text: '💰 PAID',
                    callback_data: `paid|${table}|${orderId}|${total}`
                }]]
            }
        })
    }

    ctx.reply(
        `🧾 Bill sent to the bartender.\n\n${breakdown}\n\n💰 Total: ${total} ETB`,
        buildMainMenu(config)
    )
})

// --------------------
// CALL WAITER
// --------------------
bot.hears('🆘 Call Waiter', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (!requireTable(ctx)) return
    const config = await requireConfig(ctx)
    if (!config) return
    const { table } = ctx.session
    const customer = getCustomerName(ctx)
    const tableGroup = getTableGroup(table, config)

    if (!tableGroup) {
        return ctx.reply('⚠️ Could not reach your waiter. Please ask bar staff for help.')
    }

    const callId = `call_${table.replace(/\s/g, '')}_${Date.now()}`
    await bot.telegram.sendMessage(
        tableGroup.chat_id,
        `🆘 WAITER NEEDED\n\nTable: ${table}\nCustomer: ${customer}\n\nPlease attend to this table!`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ On my way!', callback_data: `waiter_ack_${callId}_U${ctx.from.id}` }
                ]]
            }
        }
    )
    ctx.reply('🆘 Waiter has been called! Someone will be with you shortly.', buildMainMenu(config))
})

// --------------------
// TEXT CATCH-ALL — table selection and category navigation (dynamic)
// --------------------
bot.on('text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next()
    if (!ctx.session.barId) return next()
    if (ctx.message.text.startsWith('/')) return next()

    const config = await getBarConfig(ctx.session.barId)
    const text = ctx.message.text

    if (ctx.session.step === 'selecting_table') {
        const table = config.tables.find(t => t.table_name === text)
        if (!table) return next()
        const customer = getCustomerName(ctx)
        const orderId = await createOrder(config.bar.id, table.table_name, customer)
        ctx.session.orderId = orderId
        ctx.session.table = table.table_name
        ctx.session.userId = ctx.from.id
        ctx.session.step = 'ordering'
        if (!ctx.session.isStaffOrder) {
            getTableUserMap(config.bar.id)[table.table_name] = ctx.from.id
            getActiveCustomers(config.bar.id).add(ctx.from.id)
        }
        const label = ctx.session.isStaffOrder
            ? `✅ Walk-in order started for ${table.table_name}. Add items below.`
            : `✅ You are at ${table.table_name}. What would you like to order?`
        return ctx.reply(label, buildMainMenu(config))
    }

    if (!ctx.session.table) return next()

    const category = config.categories.find(c => c.name === text)
    if (category) {
        ctx.session.activeCategoryId = category.id
        ctx.session.step = 'browsing_category'
        return ctx.reply(`${category.name}\n\nChoose an item:`, buildCategoryMenu(category.id, config))
    }

    return next()
})
