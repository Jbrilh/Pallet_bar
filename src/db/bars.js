const { supabase } = require('./client')

function generateCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
}

async function getBarByOwner(ownerTelegramId) {
    const { data } = await supabase
        .from('bars')
        .select('*')
        .eq('owner_telegram_id', ownerTelegramId)
        .single()
    return data
}

async function createPendingBar(ownerTelegramId, ownerName, barName) {
    const { data, error } = await supabase
        .from('bars')
        .insert({ name: barName, owner_telegram_id: ownerTelegramId, owner_name: ownerName, status: 'pending' })
        .select('id')
        .single()
    if (error) { console.error('createPendingBar error:', error); return null }
    return data.id
}

async function updateBarStatus(barId, status) {
    const update = { status }
    if (status === 'approved') update.deep_link_code = generateCode()

    const { data, error } = await supabase
        .from('bars')
        .update(update)
        .eq('id', barId)
        .select('owner_telegram_id, name')
        .single()
    if (error) { console.error('updateBarStatus error:', error); return null }
    return status === 'approved' ? { ...data, code: update.deep_link_code } : data
}

const approveBar = barId => updateBarStatus(barId, 'approved')
const rejectBar  = barId => updateBarStatus(barId, 'rejected')

module.exports = { getBarByOwner, createPendingBar, approveBar, rejectBar }
