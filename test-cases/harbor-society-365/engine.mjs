/** Passive, deterministic world rules. Business decisions are supplied by Agent actors. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value

/** Fingerprint a JSON value independently of object key order.
 * @param value - JSON-compatible input.
 * @returns SHA-256 content identity.
 */
export const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

const integer = (value, min = 0, max = 1_000_000_000) => {
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `invalid integer: ${value}`)
  return value
}
const text = (value, min = 1, max = 4000) => {
  assert.ok(typeof value === 'string' && value.length >= min && value.length <= max, 'invalid text')
  return value
}
const id = value => {
  assert.match(text(value, 1, 100), /^[a-zA-Z0-9][a-zA-Z0-9_:/-]*$/, 'invalid identity')
  return value
}
const has = (dictionary, key) => Object.hasOwn(dictionary, key)
const actor = (state, key) => {
  assert.ok(has(state.actors, key), `unknown actor: ${key}`)
  return state.actors[key]
}
const resource = (state, key) => {
  assert.ok(state.resources.includes(key), `unknown resource: ${key}`)
  return key
}
const random = (state, day, label) => Number.parseInt(fingerprint([state.seed, day, label]).slice(0, 8), 16) / 0x100000000
const reserved = (state, owner, key) => Object.values(state.orders)
  .filter(order => order.phase === 'open' && order.seller === owner && order.resource === key)
  .reduce((sum, order) => sum + order.quantity, 0)
const available = (state, owner, key) => actor(state, owner).stocks[key] - reserved(state, owner, key)
const notice = (state, kind, message) => state.notices.push({ id: `notice-${state.noticeOrdinal++}`, day: state.day, kind, message })
const cashOut = (state, owner, quantity) => {
  assert.ok(actor(state, owner).cash >= quantity, 'insufficient cash')
  actor(state, owner).cash -= quantity
  state.cashFlow.out += quantity
}
const internalTransfer = (state, from, to, key, quantity) => {
  integer(quantity)
  assert.notEqual(from, to, 'self transfer is not a world action')
  const source = actor(state, from), target = actor(state, to)
  if (key === 'cash') {
    assert.ok(source.cash >= quantity, 'insufficient cash')
    source.cash -= quantity; target.cash += quantity
  } else {
    resource(state, key)
    assert.ok(available(state, from, key) >= quantity, 'insufficient unreserved inventory')
    source.stocks[key] -= quantity; target.stocks[key] += quantity
  }
}

/** Create the initial world without running an actor policy.
 * @param seed - Complete local case definition.
 * @returns Independent initial world.
 */
export function createWorld(seed) {
  assert.equal(seed.version, 1)
  integer(seed.horizon, 1)
  const state = { version: 1, seedHash: fingerprint(seed), seed: seed.seed, name: seed.name,
    horizon: seed.horizon, resources: [...seed.resources], day: 0, revision: 0,
    supplierId: seed.supplierId, weeklyImports: structuredClone(seed.weeklyImports), actors: {},
    offers: {}, orders: {}, loanOffers: {}, loans: {}, organizations: {}, messages: [], decisions: {},
    notices: [], noticeOrdinal: 0, messageOrdinal: 0, roadClosureUntil: -1,
    cashFlow: { initial: 0, in: 0, out: 0 }, resourceFlow: {} }
  for (const key of state.resources) state.resourceFlow[key] = { initial: 0, in: 0, out: 0 }
  for (const input of seed.actors) {
    id(input.id); assert.ok(!has(state.actors, input.id), 'duplicate actor')
    const stocks = Object.fromEntries(state.resources.map(key => [key, integer(input.stocks[key] ?? 0)]))
    state.actors[input.id] = { ...structuredClone(input), stocks, cash: integer(input.cash),
      dailyCost: integer(input.dailyCost), monthlyIncome: integer(input.monthlyIncome),
      operating: true, wellbeing: 100, trust: 50, unpaidCosts: 0 }
    state.cashFlow.initial += input.cash
    for (const key of state.resources) state.resourceFlow[key].initial += stocks[key]
  }
  actor(state, state.supplierId)
  notice(state, 'start', '世界开始；组织、交易与治理方式尚未由环境决定。')
  assertWorld(state)
  return state
}

/** Advance background conditions without actor purchases or deliveries.
 * @param input - Current world, left unchanged.
 * @param targetDay - Horizon-bounded date at most seven days ahead.
 * @returns New world, or the same object for an unchanged date.
 */
export function advanceWorld(input, targetDay) {
  integer(targetDay, input.day, input.horizon)
  assert.ok(targetDay - input.day <= 7, 'advance may span at most seven days')
  if (targetDay === input.day) return input
  const state = structuredClone(input)
  while (state.day < targetDay) {
    state.day += 1
    const hot = state.day >= 120 && state.day <= 210
    const cold = state.day >= 300 && state.day <= 330
    if ([120, 211, 300, 331].includes(state.day)) notice(state, 'season', `季节需求阶段变化：hot=${hot}, cold=${cold}。`)
    if (random(state, state.day, 'road') < 0.06) {
      state.roadClosureUntil = state.day + 1
      notice(state, 'road', `道路中断持续至第 ${state.roadClosureUntil} 日，承诺日期不会自动推迟。`)
    } else if (state.roadClosureUntil >= 0 && state.day > state.roadClosureUntil) {
      state.roadClosureUntil = -1
      notice(state, 'road', '道路重新可通行。')
    }
    if (random(state, state.day, 'rumor') < 0.05) {
      const subject = random(state, state.day, 'rumor-subject') < 0.5 ? '供销合作社' : '新岸商行'
      notice(state, 'unverified-claim', `有人声称${subject}在物资分配中偏袒某些人；这是未经核实的表述。`)
    }
    if (state.day % 7 === 0) {
      const factor = random(state, state.day, 'imports') < 0.2 ? 0.5 : 1
      for (const key of state.resources) {
        const quantity = Math.floor(state.weeklyImports[key] * factor)
        actor(state, state.supplierId).stocks[key] += quantity
        state.resourceFlow[key].in += quantity
      }
      notice(state, 'imports', `本周供应商外部到货比例为 ${factor}；到货已入账。`)
    }
    if (state.day % 30 === 0) {
      for (const owner of Object.values(state.actors)) {
        owner.cash += owner.monthlyIncome
        state.cashFlow.in += owner.monthlyIncome
      }
      notice(state, 'income', '本期固定外部资金已到账；不代表未来款项提前可用。')
    }
    for (const owner of Object.values(state.actors)) {
      if (owner.operating && owner.dailyCost > 0) {
        const paid = Math.min(owner.cash, owner.dailyCost)
        cashOut(state, owner.id, paid)
        const missing = owner.dailyCost - paid
        owner.unpaidCosts += missing
        if (missing > 0 && (state.day % 7 === 0 || owner.unpaidCosts === missing)) {
          notice(state, 'unpaid-cost', `${owner.name}存在未付经营成本。`)
        }
      }
      let shortage = 0
      const needs = { ...owner.dailyNeeds }
      if (owner.kind === 'community' && hot) needs.water = (needs.water ?? 0) + 1
      if (owner.kind === 'community' && cold) needs.fuel = (needs.fuel ?? 0) + 1
      for (const [key, needed] of Object.entries(needs)) {
        resource(state, key); integer(needed)
        const consumed = Math.min(needed, available(state, owner.id, key))
        owner.stocks[key] -= consumed
        state.resourceFlow[key].out += consumed
        shortage += needed - consumed
      }
      if (Object.keys(needs).length > 0) {
        owner.wellbeing = Math.max(0, Math.min(100, owner.wellbeing + (shortage === 0 ? 1 : -Math.min(10, shortage))))
        owner.trust = Math.max(0, Math.min(100, owner.trust + (shortage === 0 ? 0 : -1)))
        if (shortage > 0 && state.day % 7 === 0) notice(state, 'shortage', `${owner.name}本周仍有必需品短缺。`)
      }
    }
    for (const offer of [...Object.values(state.offers), ...Object.values(state.loanOffers)]) {
      if (offer.phase === 'available' && state.day > offer.expiresDay) offer.phase = 'expired'
    }
    for (const obligation of [...Object.values(state.orders), ...Object.values(state.loans)]) {
      if (obligation.phase === 'open' && state.day > obligation.dueDay && obligation.breachedAt === undefined) {
        obligation.breachedAt = state.day
        notice(state, 'overdue', `责任 ${obligation.id} 已逾期；责任仍保留。`)
      }
    }
  }
  state.revision += 1
  assertWorld(state)
  return state
}

const applyAction = (state, ownerId, action, decisionId) => {
  const owner = actor(state, ownerId)
  switch (action.kind) {
    case 'transfer': {
      integer(action.quantity, 1); actor(state, action.to)
      internalTransfer(state, ownerId, action.to, action.resource, action.quantity)
      actor(state, action.to).trust = Math.min(100, actor(state, action.to).trust + 1)
      return { kind: action.kind, to: action.to, resource: action.resource, quantity: action.quantity }
    }
    case 'offer': {
      assert.ok(owner.operating, 'inactive actor cannot issue new trade offers')
      id(action.id); assert.ok(!has(state.offers, action.id), 'offer ID already exists')
      actor(state, action.to); assert.notEqual(ownerId, action.to)
      resource(state, action.resource); integer(action.quantity, 1); integer(action.unitPrice)
      integer(action.leadDays, 0, 30); integer(action.expiresDay, state.day, state.horizon)
      state.offers[action.id] = { ...action, seller: ownerId, buyer: action.to, phase: 'available', createdDay: state.day, createdDecision: decisionId }
      return { kind: action.kind, offerId: action.id }
    }
    case 'accept': {
      assert.ok(has(state.offers, action.offerId), 'unknown offer')
      const offer = state.offers[action.offerId]
      assert.ok(offer.phase === 'available' && offer.buyer === ownerId && state.day <= offer.expiresDay, 'offer not admissible')
      assert.ok(available(state, offer.seller, offer.resource) >= offer.quantity, 'seller has insufficient unreserved inventory')
      const amount = integer(offer.quantity * offer.unitPrice)
      assert.ok(owner.cash >= amount, 'buyer cannot fund escrow')
      owner.cash -= amount; offer.phase = 'accepted'
      const orderId = `order-${offer.id}`
      state.orders[orderId] = { id: orderId, seller: offer.seller, buyer: ownerId, resource: offer.resource,
        quantity: offer.quantity, escrow: amount, amount, dueDay: state.day + offer.leadDays,
        phase: 'open', createdDay: state.day, createdDecision: decisionId }
      return { kind: action.kind, orderId }
    }
    case 'deliver': {
      assert.ok(has(state.orders, action.orderId), 'unknown order')
      const order = state.orders[action.orderId]
      assert.ok(order.phase === 'open' && order.seller === ownerId && state.day >= order.dueDay, 'order cannot be delivered by this actor or at this time')
      assert.ok(state.roadClosureUntil < state.day, 'road is currently closed')
      assert.ok(owner.stocks[order.resource] >= order.quantity, 'reserved goods missing')
      assert.ok(available(state, ownerId, 'fuel') >= 1, 'delivery requires one unreserved fuel unit')
      assert.ok(owner.cash >= 4, 'delivery requires four credits paid before settlement')
      cashOut(state, ownerId, 4)
      owner.stocks.fuel -= 1; state.resourceFlow.fuel.out += 1
      owner.stocks[order.resource] -= order.quantity
      actor(state, order.buyer).stocks[order.resource] += order.quantity
      owner.cash += order.escrow; order.escrow = 0
      order.phase = 'fulfilled'; order.fulfilledDay = state.day
      actor(state, order.buyer).trust = Math.min(100, actor(state, order.buyer).trust + 2)
      return { kind: action.kind, orderId: order.id }
    }
    case 'cancel-order': {
      assert.ok(has(state.orders, action.orderId), 'unknown order')
      const order = state.orders[action.orderId]
      assert.ok(order.phase === 'open' && order.buyer === ownerId && state.day >= order.dueDay + 2, 'only an overdue buyer can cancel')
      owner.cash += order.escrow; order.escrow = 0
      order.phase = 'cancelled'; order.cancelledDay = state.day
      actor(state, order.seller).trust = Math.max(0, actor(state, order.seller).trust - 5)
      return { kind: action.kind, orderId: order.id }
    }
    case 'loan-offer': {
      id(action.id); assert.ok(!has(state.loanOffers, action.id), 'loan offer ID already exists')
      actor(state, action.to); assert.notEqual(ownerId, action.to)
      integer(action.principal, 1); integer(action.repayAmount, action.principal); integer(action.dueDay, state.day + 1, state.horizon)
      state.loanOffers[action.id] = { ...action, lender: ownerId, borrower: action.to,
        expiresDay: action.dueDay - 1, phase: 'available', createdDay: state.day }
      return { kind: action.kind, offerId: action.id }
    }
    case 'accept-loan': {
      assert.ok(has(state.loanOffers, action.offerId), 'unknown loan offer')
      const offer = state.loanOffers[action.offerId]
      assert.ok(offer.phase === 'available' && offer.borrower === ownerId && state.day <= offer.expiresDay, 'loan offer not admissible')
      internalTransfer(state, offer.lender, ownerId, 'cash', offer.principal)
      offer.phase = 'accepted'
      const loanId = `loan-${offer.id}`
      state.loans[loanId] = { id: loanId, lender: offer.lender, borrower: ownerId,
        principal: offer.principal, repayAmount: offer.repayAmount, dueDay: offer.dueDay, phase: 'open', createdDay: state.day }
      return { kind: action.kind, loanId }
    }
    case 'repay': {
      assert.ok(has(state.loans, action.loanId), 'unknown loan')
      const loan = state.loans[action.loanId]
      assert.ok(loan.phase === 'open' && loan.borrower === ownerId, 'loan cannot be repaid by this actor')
      internalTransfer(state, ownerId, loan.lender, 'cash', loan.repayAmount)
      loan.phase = 'fulfilled'; loan.fulfilledDay = state.day
      return { kind: action.kind, loanId: loan.id }
    }
    case 'settle-costs': {
      assert.ok(owner.unpaidCosts > 0, 'there are no unpaid costs')
      const paid = owner.unpaidCosts
      cashOut(state, ownerId, paid); owner.unpaidCosts = 0
      return { kind: action.kind, paid }
    }
    case 'operating': {
      assert.equal(typeof action.value, 'boolean'); text(action.reason)
      assert.notEqual(owner.operating, action.value, 'operating state unchanged')
      owner.operating = action.value
      return { kind: action.kind, value: action.value }
    }
    case 'create-actor': {
      id(action.id); assert.ok(!has(state.actors, action.id), 'actor ID already exists')
      text(action.name); text(action.purpose); integer(action.cash); integer(action.dailyCost)
      assert.ok(['firm', 'community', 'institution', 'person'].includes(action.actorKind), 'invalid actor kind')
      const stocks = Object.fromEntries(state.resources.map(key => [key, integer(action.stocks?.[key] ?? 0)]))
      state.actors[action.id] = { id: action.id, name: action.name, kind: action.actorKind, cash: 0,
        stocks: Object.fromEntries(state.resources.map(key => [key, 0])), dailyCost: action.dailyCost,
        monthlyIncome: 0, dailyNeeds: {}, privatePurpose: action.purpose, operating: true, wellbeing: 100, trust: 50, unpaidCosts: 0 }
      internalTransfer(state, ownerId, action.id, 'cash', action.cash)
      for (const key of state.resources) internalTransfer(state, ownerId, action.id, key, stocks[key])
      return { kind: action.kind, actorId: action.id }
    }
    case 'organization': {
      id(action.id); assert.ok(!has(state.organizations, action.id), 'organization ID already exists')
      text(action.name); text(action.purpose)
      state.organizations[action.id] = { id: action.id, name: action.name, purpose: action.purpose,
        founder: ownerId, createdDay: state.day, members: { [ownerId]: 'founder' } }
      return { kind: action.kind, organizationId: action.id }
    }
    case 'join': {
      assert.ok(has(state.organizations, action.organizationId), 'unknown organization'); text(action.role)
      state.organizations[action.organizationId].members[ownerId] = action.role
      return { kind: action.kind, organizationId: action.organizationId, role: action.role }
    }
    case 'leave': {
      assert.ok(has(state.organizations, action.organizationId), 'unknown organization')
      assert.ok(has(state.organizations[action.organizationId].members, ownerId), 'actor is not a member')
      delete state.organizations[action.organizationId].members[ownerId]
      return { kind: action.kind, organizationId: action.organizationId }
    }
    case 'message': {
      assert.ok(Array.isArray(action.to) && action.to.length > 0 && action.to.length <= 32, 'invalid message recipients')
      assert.equal(new Set(action.to).size, action.to.length, 'duplicate recipient')
      for (const recipient of action.to) actor(state, recipient)
      text(action.text); integer(action.delayDays, 0, 30); assert.equal(typeof action.public, 'boolean')
      const messageId = `message-${state.messageOrdinal++}`
      state.messages.push({ id: messageId, sender: ownerId, to: [...action.to], text: action.text,
        public: action.public, createdDay: state.day, deliverDay: state.day + action.delayDays, decisionId })
      return { kind: action.kind, messageId }
    }
    default: throw new Error(`unknown action: ${action.kind}`)
  }
}

/** Apply an actor decision atomically with exact retry identity.
 * @param input - Current world, left unchanged on success or rejection.
 * @param request - Actor choice tied to the observed revision.
 * @returns New world, or the same object for an exact completed retry.
 */
export function applyDecision(input, request) {
  id(request.id)
  const requestHash = fingerprint(request)
  if (has(input.decisions, request.id)) {
    assert.equal(input.decisions[request.id].requestHash, requestHash, 'decision ID payload changed')
    return input
  }
  actor(input, request.actor); text(request.viewId); text(request.teamIdentity); text(request.rationale, 20)
  assert.equal(request.observedRevision, input.revision, 'stale actor observation; obtain a new view')
  assert.ok(Array.isArray(request.actions) && request.actions.length > 0 && request.actions.length <= 8, 'decision requires 1–8 actions')
  const state = structuredClone(input)
  const results = request.actions.map(action => applyAction(state, request.actor, action, request.id))
  state.revision += 1
  state.decisions[request.id] = { id: request.id, actor: request.actor, day: state.day, revision: state.revision,
    viewId: request.viewId, teamIdentity: request.teamIdentity, rationale: request.rationale,
    actions: structuredClone(request.actions), results, requestHash,
    material: request.actions.some(action => action.kind !== 'message') }
  assertWorld(state)
  return state
}

/** Return one actor's state, contracts and delivered information.
 * @param state - Current world.
 * @param ownerId - Exact viewing actor.
 * @returns Detached actor view without foreign private accounts or purposes.
 */
export function actorView(state, ownerId) {
  const own = actor(state, ownerId)
  return structuredClone({ day: state.day, revision: state.revision, actor: ownerId, self: own,
    availableStocks: Object.fromEntries(state.resources.map(key => [key, available(state, ownerId, key)])),
    actors: Object.values(state.actors).map(({ id, name, kind, operating }) => ({ id, name, kind, operating })),
    tradeOffers: Object.values(state.offers).filter(offer => offer.seller === ownerId || offer.buyer === ownerId),
    orders: Object.values(state.orders).filter(order => order.seller === ownerId || order.buyer === ownerId),
    loanOffers: Object.values(state.loanOffers).filter(offer => offer.lender === ownerId || offer.borrower === ownerId),
    loans: Object.values(state.loans).filter(loan => loan.lender === ownerId || loan.borrower === ownerId),
    organizations: Object.values(state.organizations), roadClosureUntil: state.roadClosureUntil,
    notices: state.notices.filter(item => item.day >= state.day - 30),
    scheduledMessages: state.messages.filter(item => item.sender === ownerId && item.deliverDay > state.day),
    messages: state.messages.filter(item => item.deliverDay <= state.day && item.deliverDay >= state.day - 60
      && (item.public || item.to.includes(ownerId) || item.sender === ownerId)).slice(-100) })
}

/** Verify assets, reservations and external-flow accounting.
 * @param state - World to inspect without mutation.
 * @returns Conservation totals; invalid worlds throw.
 */
export function assertWorld(state) {
  let cash = 0
  const stocks = Object.fromEntries(state.resources.map(key => [key, 0]))
  for (const owner of Object.values(state.actors)) {
    integer(owner.cash); integer(owner.unpaidCosts)
    cash += owner.cash
    for (const key of state.resources) {
      integer(owner.stocks[key]); assert.ok(available(state, owner.id, key) >= 0, 'inventory reservations exceed owned goods')
      stocks[key] += owner.stocks[key]
    }
  }
  for (const order of Object.values(state.orders)) {
    integer(order.escrow)
    if (order.phase === 'open') { assert.equal(order.escrow, order.amount); cash += order.escrow }
    else assert.equal(order.escrow, 0)
  }
  assert.equal(cash, state.cashFlow.initial + state.cashFlow.in - state.cashFlow.out, 'cash conservation failure')
  for (const key of state.resources) {
    const flow = state.resourceFlow[key]
    assert.equal(stocks[key], flow.initial + flow.in - flow.out, `${key} conservation failure`)
  }
  return { cash, stocks, cashFlow: structuredClone(state.cashFlow), resourceFlow: structuredClone(state.resourceFlow) }
}

/** Replay events and verify every revision and world fingerprint.
 * @param seed - Original case seed.
 * @param events - Complete journal or an initialized prefix.
 * @returns Reconstructed world; altered history throws.
 */
export function replayWorld(seed, events) {
  assert.ok(events.length > 0 && events[0].kind === 'init', 'world has no initialization record')
  let state = createWorld(seed)
  assert.equal(events[0].stateHash, fingerprint(state), 'initial world fingerprint differs')
  for (const entry of events.slice(1)) {
    if (entry.kind === 'decision') state = applyDecision(state, entry.payload)
    else if (entry.kind === 'advance') state = advanceWorld(state, entry.payload.targetDay)
    else throw new Error(`unknown journal event: ${entry.kind}`)
    assert.equal(entry.revision, state.revision, 'journal revision differs')
    assert.equal(entry.stateHash, fingerprint(state), 'world history fingerprint differs')
  }
  assertWorld(state)
  return state
}
