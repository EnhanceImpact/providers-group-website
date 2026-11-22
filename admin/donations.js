// Donation-only dashboard behavior; uses the existing authenticated sb client and escaping helper.
let donationPage = 0;
let donationGeneration = 0;
const donationPageSize = 50;
const donationMoney = (cents, currency) => {
  const value = BigInt(cents);
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).formatToParts(value / 100n).map(part => part.type === 'fraction'
    ? (value % 100n).toString().padStart(2, '0') : part.value).join('');
};
const donationActive = () => document.querySelector('.tabs button.active')?.dataset.view === 'donations';

async function loadDonationMetrics() {
  const total = document.querySelector('#m-donations');
  const donors = document.querySelector('#m-donors');
  try {
    const { data, error } = await sb.rpc('donation_summary');
    if (error) throw error;
    total.textContent = data.totals.length ? data.totals.map(t => donationMoney(t.net_cents, t.currency)).join(' / ') : '0';
    donors.textContent = String(data.unique_donors);
    total.removeAttribute('title');
    donors.removeAttribute('title');
  } catch {
    total.textContent = donors.textContent = '-';
    total.title = donors.title = 'Donation metrics could not be loaded.';
  }
}

async function loadDonations() {
  const generation = ++donationGeneration;
  status.textContent = 'Loading donations...';
  document.querySelector('#blog-tools').hidden = true;
  const previous = document.querySelector('#donation-previous');
  const next = document.querySelector('#donation-next');
  previous.disabled = next.disabled = true;
  document.querySelector('#thead').innerHTML = '<tr>' +
    ['Donor name', 'Email address', 'ZIP code', 'Donation amount', 'Donation date', 'Payment status']
      .map(label => `<th>${esc(label)}</th>`).join('') + '</tr>';
  document.querySelector('#tbody').innerHTML = '';
  try {
    const { data, error } = await sb.rpc('donation_history', {
      p_search: document.querySelector('#donation-search').value,
      p_ascending: document.querySelector('#donation-sort').value === 'oldest',
      p_offset: donationPage * donationPageSize, p_limit: donationPageSize + 1,
    });
    if (generation !== donationGeneration || !donationActive()) return;
    if (error) throw error;
    const rows = data.slice(0, donationPageSize);
    document.querySelector('#tbody').innerHTML = rows.map(row => {
      const name = [row.donor_first_name, row.donor_last_name].filter(Boolean).join(' ') || '-';
      const date = new Date(row.donated_at).toLocaleString();
      const paymentStatus = { succeeded: 'Succeeded', partially_refunded: 'Partially refunded', refunded: 'Refunded' }[row.payment_status] || '-';
      const amount = donationMoney(row.amount_cents, row.currency);
      const refund = Number(row.refunded_amount_cents) > 0 ? ` (refunded ${donationMoney(row.refunded_amount_cents, row.currency)})` : '';
      return '<tr>' + [name, row.email || '-', row.zip_code || '-', amount + refund, date, paymentStatus]
        .map(value => `<td>${esc(value)}</td>`).join('') + '</tr>';
    }).join('');
    status.textContent = rows.length ? `${donationPage * donationPageSize + 1}-${donationPage * donationPageSize + rows.length} donations` : 'No donations found.';
    previous.disabled = donationPage === 0;
    next.disabled = data.length <= donationPageSize;
  } catch {
    if (generation !== donationGeneration || !donationActive()) return;
    status.textContent = 'Donations could not be loaded. Please try again.';
    previous.disabled = donationPage === 0;
  }
}

document.querySelector('#donation-filters').addEventListener('submit', event => {
  event.preventDefault(); donationPage = 0; loadDonations();
});
document.querySelector('#donation-sort').addEventListener('change', () => { donationPage = 0; loadDonations(); });
document.querySelector('#donation-previous').addEventListener('click', () => { if (donationPage > 0) { donationPage--; loadDonations(); } });
document.querySelector('#donation-next').addEventListener('click', () => { donationPage++; loadDonations(); });
