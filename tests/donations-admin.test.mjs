import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', disabled: false, hidden: false,
      textContent: '', innerHTML: '', events: {}, dataset: { view: 'donations' },
      addEventListener(type, fn) { this.events[type] = fn; }, removeAttribute(key) { delete this[key]; } });
    return nodes.get(selector);
  };
  get('#donation-sort').value = 'newest';
  const calls = [];
  const context = vm.createContext({ Intl, BigInt, Date, document: { querySelector: get },
    status: get('#admin-status'),
    esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    sb: { rpc: async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; } },
  });
  vm.runInContext(readFileSync(new URL('../admin/donations.js', import.meta.url), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  return { context, get, calls, run };
}

test('donation rendering escapes private data and renders amounts/refunds/missing fields', async () => {
  const { context, get, run } = fixture();
  context.sb.rpc = async () => ({ data: [{ donor_first_name: '<img onerror=alert(1)>', donor_last_name: 'A&B',
    email: '<test>@example.invalid', zip_code: '00501', amount_cents: '2500', currency: 'usd',
    donated_at: '2026-11-01T12:00:00Z', payment_status: 'partially_refunded', refunded_amount_cents: '500' },
  { amount_cents: '100', currency: 'usd', donated_at: '2026-11-02T12:00:00Z', payment_status: 'succeeded', refunded_amount_cents: 0 }], error: null });
  await run('loadDonations()');
  const html = get('#tbody').innerHTML;
  assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img')); assert.ok(html.includes('A&amp;B'));
  assert.ok(html.includes('00501')); assert.ok(html.includes('25.00')); assert.ok(html.includes('refunded'));
  assert.ok(html.includes('5.00')); assert.ok(html.includes('<td>-</td>')); assert.ok(html.includes('Partially refunded'));
  assert.equal((get('#thead').innerHTML.match(/<th>/g) || []).length, 6);
});

test('metrics keep integer-cent precision and separate currency totals; errors do not alter other cards', async () => {
  const { context, get, run } = fixture();
  assert.ok(run("donationMoney('900719925474099101','usd')").endsWith('.01'));
  context.sb.rpc = async () => ({ data: { totals: [{ currency: 'usd', net_cents: '3750' }, { currency: 'cad', net_cents: '1000' }], unique_donors: 3 }, error: null });
  await run('loadDonationMetrics()');
  assert.ok(get('#m-donations').textContent.includes('37.50')); assert.ok(get('#m-donations').textContent.includes('10.00'));
  assert.equal(get('#m-donors').textContent, '3');
  context.sb.rpc = async () => ({ data: null, error: new Error('synthetic') });
  await run('loadDonationMetrics()'); assert.equal(get('#m-donations').textContent, '-');
});

test('search/date sorting and paging send parameterized RPCs; empty/error and tab-race handling', async () => {
  const { context, get, calls, run } = fixture();
  get('#donation-search').value = "O'Hara_%"; get('#donation-sort').value = 'oldest';
  await run('loadDonations()');
  assert.equal(calls[0].args.p_search, "O'Hara_%"); assert.equal(calls[0].args.p_ascending, true);
  assert.equal(calls[0].args.p_limit, 51); assert.equal(get('#admin-status').textContent, 'No donations found.');
  await run('donationPage=2;loadDonations()'); assert.equal(calls.at(-1).args.p_offset, 100);
  context.sb.rpc = async () => ({ data: null, error: new Error('synthetic') });
  await run('loadDonations()'); assert.ok(get('#admin-status').textContent.includes('could not be loaded'));
  let resolve; context.sb.rpc = () => new Promise(r => { resolve = r; });
  const pending = run('loadDonations()');
  get('.tabs button.active').dataset.view = 'contacts'; get('#tbody').innerHTML = 'existing contacts';
  resolve({ data: [], error: null }); await pending;
  assert.equal(get('#tbody').innerHTML, 'existing contacts');
});
