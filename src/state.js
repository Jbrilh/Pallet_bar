const state = {
    barIsOpen: true,
    orderCounter: 0
}

const tableUserMap = {}
const activeCustomers = new Set()

function nextOrderNumber() {
    state.orderCounter += 1
    return state.orderCounter
}

function resetOrderCounter() {
    state.orderCounter = 0
}

module.exports = { state, tableUserMap, activeCustomers, nextOrderNumber, resetOrderCounter }
