const { supabase } = require('./client')
const { bot } = require('../bot')

async function deductStock(barId, cart, ownerGroupChatId) {
    for (const item of cart) {
        const { data: stockRow, error } = await supabase
            .from('stock')
            .select('id, quantity, low_stock_threshold')
            .eq('bar_id', barId)
            .eq('item_name', item.name)
            .single()

        if (error || !stockRow) continue

        const newQty = Math.max(0, stockRow.quantity - item.qty)

        await supabase
            .from('stock')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', stockRow.id)

        if (ownerGroupChatId && newQty <= stockRow.low_stock_threshold) {
            const emoji = newQty === 0 ? '❌' : '⚠️'
            const status = newQty === 0 ? 'OUT OF STOCK' : 'LOW STOCK'
            await bot.telegram.sendMessage(
                ownerGroupChatId,
                `${emoji} ${status} ALERT\n\nItem: ${item.name}\nRemaining: ${newQty} units\nThreshold: ${stockRow.low_stock_threshold} units\n\nPlease restock soon!`
            ).catch(e => console.log('Stock alert error:', e.message))
        }
    }
}

module.exports = { deductStock }
