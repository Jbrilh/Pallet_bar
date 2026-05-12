const orderCounters = new Map()        // barId → number
const tableUserMaps = new Map()        // barId → { tableName: userId }
const activeCustomersByBar = new Map() // barId → Set<userId>

function getTableUserMap(barId) {
    if (!tableUserMaps.has(barId)) tableUserMaps.set(barId, {})
    return tableUserMaps.get(barId)
}

function getActiveCustomers(barId) {
    if (!activeCustomersByBar.has(barId)) activeCustomersByBar.set(barId, new Set())
    return activeCustomersByBar.get(barId)
}

function nextOrderNumber(barId) {
    const n = (orderCounters.get(barId) || 0) + 1
    orderCounters.set(barId, n)
    return n
}

function resetOrderCounter(barId) {
    orderCounters.set(barId, 0)
}

module.exports = { getTableUserMap, getActiveCustomers, nextOrderNumber, resetOrderCounter }
