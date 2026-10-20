(function () {
  'use strict';
  var KEY = 'theomax-proforma-v1';
  var CLOUD_KEY = 'theomax-proforma-cloud-v1';
  var cloudConfig = readCloudConfig();
  var cloudTimer;
  var cloudBusy = false;
  var defaults = {
    settings: {
      name: 'Theomax Wood Works',
      address: 'Ndeeba, Masaka Road',
      email: 'eugeneagaba@gmail.com',
      phones: '+256772482423, +256703160100',
      tagline: 'SOLID AS AFRICAN WOOD',
      prefix: 'TMX',
      logo: 'theomax-logo.bmp'
    },
    customers: [],
    products: [],
    invoices: [],
    nextNumber: 1
  };
  var state = loadState();
  var draftItems = [];
  var toastTimer;
  var pageTitles = {
    dashboard: ['OVERVIEW', 'Dashboard'],
    'new-invoice': ['DOCUMENTS', 'New proforma invoice'],
    history: ['DOCUMENTS', 'Invoice history'],
    customers: ['DIRECTORY', 'Customers'],
    products: ['CATALOG', 'Products & services'],
    settings: ['PREFERENCES', 'Company settings']
  };

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      var settings = Object.assign({}, defaults.settings, saved.settings || {});
      var customers = Array.isArray(saved.customers) ? saved.customers : [];
      var products = Array.isArray(saved.products) ? saved.products : [];
      var invoices = Array.isArray(saved.invoices) ? saved.invoices : [];
      var numbering = normalizeQuoteNumbering(settings, invoices, saved.nextNumber);
      return {
        settings: numbering.settings,
        customers: customers,
        products: products,
        invoices: invoices,
        nextNumber: numbering.nextNumber
      };
    } catch (error) {
      return JSON.parse(JSON.stringify(defaults));
    }
  }
  function normalizeQuoteNumbering(settings, invoices, nextNumber) {
    var updatedSettings = Object.assign({}, settings || {});
    var prefix = String(updatedSettings.prefix || 'TMX').trim().toUpperCase();
    var sequence = Number(nextNumber);
    if (prefix === 'Q') { prefix = 'TMX'; sequence = 1; }
    if (!Number.isFinite(sequence) || sequence < 1) sequence = 1;
    updatedSettings.prefix = prefix;
    prefix = prefix.replace(/[^A-Z0-9]/g, '');
    var pattern = new RegExp('^' + prefix + '-(\\d+)$', 'i');
    var largest = 0;
    (invoices || []).forEach(function (invoice) {
      var match = pattern.exec(String(invoice.number || ''));
      if (match) largest = Math.max(largest, Number(match[1]) || 0);
    });
    return {settings:updatedSettings, nextNumber:Math.max(sequence, largest + 1)};
  }
  function readCloudConfig() {
    try { return JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}'); }
    catch (error) { return {}; }
  }
  function setCloudStatus(message, error) {
    var status = document.getElementById('cloudStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('cloud-error', !!error);
  }
  function saveCloudConfig() {
    cloudConfig.url = document.getElementById('cloudUrl').value.trim().replace(/\/$/, '');
    cloudConfig.key = document.getElementById('cloudKey').value.trim();
    localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudConfig));
    setCloudStatus(cloudConfig.accessToken ? 'Cloud connection saved. Signed in as ' + (cloudConfig.email || 'your account') + '.' : 'Cloud connection saved. Sign in to sync your devices.');
  }
  function cloudHeaders(auth) {
    return {'apikey':cloudConfig.key, 'Authorization':'Bearer ' + (auth && cloudConfig.accessToken ? cloudConfig.accessToken : cloudConfig.key), 'Content-Type':'application/json'};
  }
  async function cloudRequest(path, options, auth) {
    var request = Object.assign({headers:cloudHeaders(auth)}, options || {});
    var response = await fetch(cloudConfig.url + path, request);
    if (response.status === 401 && auth && cloudConfig.refreshToken && path.indexOf('/auth/v1/token') !== 0) {
      var refresh = await fetch(cloudConfig.url + '/auth/v1/token?grant_type=refresh_token', {method:'POST', headers:cloudHeaders(false), body:JSON.stringify({refresh_token:cloudConfig.refreshToken})});
      var session = await refresh.json().catch(function () { return {}; });
      if (refresh.ok && session.access_token) {
        cloudConfig.accessToken = session.access_token;
        cloudConfig.refreshToken = session.refresh_token || cloudConfig.refreshToken;
        cloudConfig.userId = session.user && session.user.id || cloudConfig.userId;
        localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudConfig));
        request.headers = Object.assign({}, request.headers, cloudHeaders(true));
        response = await fetch(cloudConfig.url + path, request);
      }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || body.error || 'Cloud request failed (' + response.status + ').');
    return body;
  }
  function mergeCloudState(data, remoteWins) {
    if (!data) return;
    function mergeRows(localRows, remoteRows) {
      var rows = {};
      (remoteRows || []).concat(localRows || []).forEach(function (row) { rows[row.id] = row; });
      return Object.keys(rows).map(function (key) { return rows[key]; });
    }
    state = {
      settings:remoteWins ? Object.assign({}, defaults.settings, state.settings || {}, data.settings || {}) : Object.assign({}, defaults.settings, data.settings || {}, state.settings || {}),
      customers:mergeRows(state.customers, data.customers),
      products:mergeRows(state.products, data.products),
      invoices:mergeRows(state.invoices, data.invoices),
      nextNumber:Math.max(Number(state.nextNumber) || defaults.nextNumber, Number(data.nextNumber) || defaults.nextNumber)
    };
    var numbering = normalizeQuoteNumbering(state.settings, state.invoices, state.nextNumber);
    state.settings = numbering.settings;
    state.nextNumber = numbering.nextNumber;
    persist(true);
    setBrand(); fillProductOptions(); fillInvoiceCustomers(); renderDashboard(); renderHistory(); renderCustomers(); renderProducts();
  }
  async function syncCloud(preferRemote) {
    if (!cloudConfig.url || !cloudConfig.key || !cloudConfig.accessToken || !cloudConfig.userId || cloudBusy) return;
    cloudBusy = true;
    try {
      var rows = await cloudRequest('/rest/v1/proforma_workspaces?user_id=eq.' + encodeURIComponent(cloudConfig.userId) + '&select=data', {}, true);
      if (rows.length) mergeCloudState(rows[0].data, !!preferRemote);
      await cloudRequest('/rest/v1/proforma_workspaces?on_conflict=user_id', {
        method:'POST',
        headers:Object.assign(cloudHeaders(true), {'Prefer':'resolution=merge-duplicates,return=minimal'}),
        body:JSON.stringify({user_id:cloudConfig.userId, data:state, updated_at:new Date().toISOString()})
      }, true);
      setCloudStatus('Synced. Sign in with this account on your other devices to use these records.');
    } catch (error) {
      setCloudStatus('Saved on this device. Cloud sync needs attention: ' + error.message, true);
    } finally { cloudBusy = false; }
  }
  function scheduleCloudSync() {
    clearTimeout(cloudTimer);
    if (cloudConfig.accessToken) cloudTimer = setTimeout(syncCloud, 700);
  }
  function prepareCloudForm() {
    document.getElementById('cloudUrl').value = cloudConfig.url || '';
    document.getElementById('cloudKey').value = cloudConfig.key || '';
    document.getElementById('cloudEmail').value = cloudConfig.email || '';
    document.getElementById('storageStatus').textContent = cloudConfig.accessToken ? 'Cloud account · sync enabled' : 'Device storage · sign in to sync';
    setCloudStatus(cloudConfig.accessToken ? 'Signed in as ' + (cloudConfig.email || 'your account') + '.' : 'Not connected. Records are saved on this device.');
  }
  async function cloudAuth(createAccount) {
    saveCloudConfig();
    var email = document.getElementById('cloudEmail').value.trim();
    var password = document.getElementById('cloudPassword').value;
    if (!cloudConfig.url || !cloudConfig.key || !email || !password) { setCloudStatus('Enter the project URL, public key, email and password first.', true); return; }
    try {
      setCloudStatus(createAccount ? 'Creating account…' : 'Signing in…');
      var result = await cloudRequest(createAccount ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', {method:'POST', body:JSON.stringify({email:email, password:password})}, false);
      document.getElementById('cloudPassword').value = '';
      if (!result.access_token || !result.user) { setCloudStatus('Account created. Confirm your email, then sign in here.'); return; }
      cloudConfig.accessToken = result.access_token;
      cloudConfig.refreshToken = result.refresh_token || '';
      cloudConfig.userId = result.user.id;
      cloudConfig.email = result.user.email || email;
      localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudConfig));
      document.getElementById('storageStatus').textContent = 'Cloud account · sync enabled';
      await syncCloud(true);
      prepareCloudForm();
      showToast(createAccount ? 'Account created.' : 'Signed in. Cloud records are ready.');
    } catch (error) { setCloudStatus(error.message, true); }
  }
  async function restoreCloudSession() {
    if (!cloudConfig.accessToken || !cloudConfig.url || !cloudConfig.key) return;
    await syncCloud(true);
  }
  function persist(skipCloud) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (!skipCloud) scheduleCloudSync();
      return true;
    } catch (error) {
      showToast('Could not save. Export a backup or choose a smaller logo image.', true);
      return false;
    }
  }
  function id() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }
  function money(value) {
    var amount = Number(value) || 0;
    try { return new Intl.NumberFormat('en-UG', {maximumFractionDigits: 0}).format(amount); }
    catch (error) { return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  }
  function fullMoney(value) { return 'UGX ' + money(value); }
  function todayISO() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function dateLabel(value) {
    if (!value) return '';
    var parts = String(value).split('-');
    if (parts.length !== 3) return value;
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }
  function showToast(message, isError) {
    var element = document.getElementById('toast');
    element.textContent = message;
    element.style.background = isError ? '#8c302b' : '';
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove('show'); }, 2800);
  }
  function go(page) {
    if (!pageTitles[page]) return;
    document.querySelectorAll('.page').forEach(function (element) {
      element.classList.toggle('active', element.id === 'page-' + page);
    });
    document.querySelectorAll('.nav-link').forEach(function (element) {
      element.classList.toggle('active', element.dataset.page === page);
    });
    document.getElementById('pageEyebrow').textContent = pageTitles[page][0];
    document.getElementById('pageTitle').textContent = pageTitles[page][1];
    if (page === 'dashboard') renderDashboard();
    if (page === 'new-invoice') prepareInvoice();
    if (page === 'history') renderHistory();
    if (page === 'customers') renderCustomers();
    if (page === 'products') renderProducts();
    if (page === 'settings') loadSettingsForm();
    window.scrollTo(0, 0);
  }
  function nextInvoiceNumber() {
    return (state.settings.prefix || 'TMX').trim().toUpperCase() + '-' + String(state.nextNumber).padStart(3, '0');
  }
  function setBrand() {
    document.getElementById('brandName').textContent = state.settings.name || 'Your company';
    var mark = document.getElementById('brandMark');
    if (state.settings.logo) {
      mark.innerHTML = '<img src="' + esc(state.settings.logo) + '" alt=\"\" />';
      mark.classList.add('has-logo');
    } else {
      mark.textContent = initials(state.settings.name);
      mark.classList.remove('has-logo');
    }
  }
  function initials(name) {
    return String(name || 'TMX').split(/\s+/).filter(Boolean).slice(0, 3).map(function (word) { return word[0]; }).join('').toUpperCase();
  }
  function renderDashboard() {
    var now = new Date();
    var monthInvoices = state.invoices.filter(function (invoice) {
      var date = new Date(String(invoice.date) + 'T00:00:00');
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    document.getElementById('todayLabel').textContent = now.toLocaleDateString('en-UG', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
    document.getElementById('metricMonth').textContent = monthInvoices.length;
    document.getElementById('metricTotal').textContent = fullMoney(monthInvoices.reduce(function (sum, invoice) { return sum + Number(invoice.total || 0); }, 0));
    document.getElementById('metricCustomers').textContent = state.customers.length;
    var target = document.getElementById('recentInvoices');
    if (!state.invoices.length) {
      target.innerHTML = '<div class=\"table-empty\">No invoices yet. Create your first proforma to get started.</div>';
      return;
    }
    target.innerHTML = invoiceTable(state.invoices.slice().sort(byNewest).slice(0, 5), false);
  }
  function byNewest(a, b) { return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)); }
  function invoiceTable(invoices, showAction) {
    if (!invoices.length) return '<div class=\"table-empty\">No matching invoices found.</div>';
    var rows = invoices.map(function (invoice) {
      return '<tr><td><strong>' + esc(invoice.number) + '</strong><span class=\"table-secondary\">Proforma invoice</span></td>' +
        '<td>' + esc(dateLabel(invoice.date)) + '</td><td>' + esc(invoice.customer && invoice.customer.name) + '</td>' +
        '<td class=\"align-right\"><strong>' + money(invoice.total) + '</strong></td>' +
        '<td class=\"action-cell\"><button class=\"button button-light row-action\" data-print-invoice=\"' + esc(invoice.id) + '\">Print</button>' +
        (showAction ? '<button class=\"icon-action\" title=\"Delete invoice\" data-delete-invoice=\"' + esc(invoice.id) + '\">×</button>' : '') + '</td></tr>';
    }).join('');
    return '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class=\"align-right\">Total (UGX)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function renderHistory() {
    var query = (document.getElementById('historySearch').value || '').trim().toLowerCase();
    var matches = state.invoices.filter(function (invoice) {
      return !query || String(invoice.number).toLowerCase().includes(query) || String(invoice.customer && invoice.customer.name).toLowerCase().includes(query);
    }).sort(byNewest);
    document.getElementById('historyTable').innerHTML = invoiceTable(matches, true);
  }
  function renderCustomers() {
    var target = document.getElementById('customerTable');
    if (!state.customers.length) {
      target.innerHTML = '<div class=\"table-empty\">No customers yet. Add a customer before preparing your first invoice.</div>';
      return;
    }
    var rows = state.customers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (customer) {
      return '<tr><td><div class=\"table-customer\"><span class=\"avatar\">' + esc(initials(customer.name).slice(0, 2)) + '</span><span><strong>' + esc(customer.name) + '</strong><span class=\"table-secondary\">' + esc(customer.address || 'No address saved') + '</span></span></div></td>' +
        '<td>' + esc(customer.phone || '—') + '</td><td>' + esc(customer.email || '—') + '</td><td class=\"action-cell\"><button class=\"text-button\" data-edit-customer=\"' + esc(customer.id) + '\">Edit</button><button class=\"text-button danger-text\" data-delete-customer=\"' + esc(customer.id) + '\">Delete</button></td></tr>';
    }).join('');
    target.innerHTML = '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function renderProducts() {
    var target = document.getElementById('productTable');
    if (!state.products.length) {
      target.innerHTML = '<div class=\"table-empty\">No saved products yet. You can still type descriptions directly on an invoice.</div>';
      return;
    }
    var rows = state.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (product) {
      return '<tr><td><strong>' + esc(product.name) + '</strong></td><td class=\"align-right\">' + money(product.price) + '</td><td class=\"action-cell\"><button class=\"text-button\" data-edit-product=\"' + esc(product.id) + '\">Edit</button><button class=\"icon-action\" title=\"Delete product\" data-delete-product=\"' + esc(product.id) + '\">×</button></td></tr>';
    }).join('');
    target.innerHTML = '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>Description</th><th class=\"align-right\">Unit price (UGX)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function prepareInvoice() {
    if (document.getElementById('invoiceNumber').value) {
      fillInvoiceCustomers();
      return;
    }
    fillInvoiceCustomers();
    document.getElementById('invoiceNumber').value = nextInvoiceNumber();
    document.getElementById('invoiceDate').value = todayISO();
    document.getElementById('invoiceNotes').value = '';
    draftItems = [];
    renderDraftItems();
  }
  function fillInvoiceCustomers() {
    var select = document.getElementById('invoiceCustomer');
    var selected = select.value;
    select.innerHTML = '<option value=\"\">Choose a customer</option>' + state.customers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (customer) {
      return '<option value=\"' + esc(customer.id) + '\">' + esc(customer.name) + '</option>';
    }).join('');
    if (state.customers.some(function (customer) { return customer.id === selected; })) select.value = selected;
  }
  function resetInvoice() {
    document.getElementById('invoiceNumber').value = '';
    document.getElementById('invoiceCustomer').value = '';
    document.getElementById('itemParticulars').value = '';
    document.getElementById('itemDescription').value = '';
    document.getElementById('itemQuantity').value = '1';
    document.getElementById('itemPrice').value = '';
    document.getElementById('invoiceNotes').value = '';
    draftItems = [];
    renderDraftItems();
  }
  function addLine() {
    var particulars = document.getElementById('itemParticulars').value.trim();
    var description = document.getElementById('itemDescription').value.trim();
    var quantity = Number(document.getElementById('itemQuantity').value);
    var price = Number(document.getElementById('itemPrice').value);
    if (!particulars) { showToast('Enter the item particulars.', true); document.getElementById('itemParticulars').focus(); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { showToast('Quantity must be greater than zero.', true); return; }
    if (!Number.isFinite(price) || price < 0) { showToast('Enter a valid unit price.', true); return; }
    draftItems.push({id:id(), particulars:particulars, description:description, quantity:quantity, unitPrice:price, total:quantity * price});
    document.getElementById('itemParticulars').value = '';
    document.getElementById('itemDescription').value = '';
    document.getElementById('itemQuantity').value = '1';
    document.getElementById('itemPrice').value = '';
    renderDraftItems();
    document.getElementById('itemParticulars').focus();
  }
  function renderDraftItems() {
    var tbody = document.getElementById('lineItems');
    if (!draftItems.length) {
      tbody.innerHTML = '<tr class=\"empty-row\"><td colspan=\"5\">No items added yet. Add your first item above.</td></tr>';
    } else {
      tbody.innerHTML = draftItems.map(function (item) {
        var title = item.particulars || item.description || '';
        var detail = item.particulars ? item.description : '';
        return '<tr><td>' + esc(item.quantity) + '</td><td><strong>' + esc(title) + '</strong>' + (detail ? '<span class=\"line-description\">' + esc(detail) + '</span>' : '') + '</td><td>' + money(item.unitPrice) + '</td><td>' + money(item.total) + '</td><td><button class=\"icon-action\" data-remove-line=\"' + esc(item.id) + '\" title=\"Remove item\">×</button></td></tr>';
      }).join('');
    }
    var total = draftItems.reduce(function (sum, item) { return sum + item.total; }, 0);
    document.getElementById('invoiceTotal').textContent = money(total);
    document.getElementById('summaryTotal').textContent = fullMoney(total);
    document.getElementById('summaryCount').textContent = draftItems.length;
  }
  function saveInvoice() {
    var customerId = document.getElementById('invoiceCustomer').value;
    var customer = state.customers.find(function (entry) { return entry.id === customerId; });
    if (!customer) { showToast('Choose a customer for this invoice.', true); document.getElementById('invoiceCustomer').focus(); return; }
    if (!draftItems.length) { showToast('Add at least one item before saving.', true); return; }
    var date = document.getElementById('invoiceDate').value;
    if (!date) { showToast('Choose an invoice date.', true); return; }
    var invoice = {
      id: id(),
      number: document.getElementById('invoiceNumber').value || nextInvoiceNumber(),
      date: date,
      createdAt: new Date().toISOString(),
      customer: {name:customer.name, phone:customer.phone || '', email:customer.email || '', address:customer.address || ''},
      items: draftItems.map(function (item) { return Object.assign({}, item); }),
      total: draftItems.reduce(function (sum, item) { return sum + item.total; }, 0),
      notes: document.getElementById('invoiceNotes').value.trim()
    };
    state.invoices.push(invoice);
    state.nextNumber += 1;
    if (!persist()) { state.invoices.pop(); state.nextNumber -= 1; return; }
    renderDashboard();
    resetInvoice();
    showToast('Saved ' + invoice.number + '.');
    go('history');
  }
  function openCustomerDialog(customer) {
    var form = document.getElementById('customerForm');
    form.reset();
    document.getElementById('customerId').value = customer ? customer.id : '';
    document.getElementById('customerDialogTitle').textContent = customer ? 'Edit customer' : 'Add customer';
    document.getElementById('customerName').value = customer ? customer.name : '';
    document.getElementById('customerPhone').value = customer ? customer.phone || '' : '';
    document.getElementById('customerEmail').value = customer ? customer.email || '' : '';
    document.getElementById('customerAddress').value = customer ? customer.address || '' : '';
    document.getElementById('customerDialog').showModal();
  }
  function saveCustomer(event) {
    event.preventDefault();
    var name = document.getElementById('customerName').value.trim();
    if (!name) return;
    var customerId = document.getElementById('customerId').value;
    var customer = {
      id: customerId || id(),
      name:name,
      phone:document.getElementById('customerPhone').value.trim(),
      email:document.getElementById('customerEmail').value.trim(),
      address:document.getElementById('customerAddress').value.trim()
    };
    if (customerId) state.customers = state.customers.map(function (entry) { return entry.id === customerId ? customer : entry; });
    else state.customers.push(customer);
    persist();
    document.getElementById('customerDialog').close();
    renderCustomers(); fillInvoiceCustomers(); renderDashboard();
    if (document.getElementById('page-new-invoice').classList.contains('active')) document.getElementById('invoiceCustomer').value = customer.id;
    showToast(customerId ? 'Customer updated.' : 'Customer saved.');
  }
  function openProductDialog(product) {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = product ? product.id : '';
    document.getElementById('productDialogTitle').textContent = product ? 'Edit product or service' : 'Add product or service';
    document.getElementById('productName').value = product ? product.name : '';
    document.getElementById('productPrice').value = product ? product.price : '';
    document.getElementById('productDialog').showModal();
  }
  function saveProduct(event) {
    event.preventDefault();
    var name = document.getElementById('productName').value.trim();
    var price = Number(document.getElementById('productPrice').value);
    if (!name || !Number.isFinite(price) || price < 0) return;
    var productId = document.getElementById('productId').value;
    var product = {id:productId || id(), name:name, price:price};
    if (productId) state.products = state.products.map(function (entry) { return entry.id === productId ? product : entry; });
    else state.products.push(product);
    persist();
    document.getElementById('productDialog').close();
    renderProducts(); fillProductOptions();
    showToast(productId ? 'Product updated.' : 'Product saved.');
  }
  function fillProductOptions() {
    document.getElementById('productOptions').innerHTML = state.products.map(function (product) {
      return '<option value=\"' + esc(product.name) + '\"></option>';
    }).join('');
  }
  function loadSettingsForm() {
    document.getElementById('settingName').value = state.settings.name || '';
    document.getElementById('settingAddress').value = state.settings.address || '';
    document.getElementById('settingEmail').value = state.settings.email || '';
    document.getElementById('settingPhones').value = state.settings.phones || '';
    document.getElementById('settingTagline').value = state.settings.tagline || '';
    document.getElementById('settingPrefix').value = state.settings.prefix || 'TMX';
    updateLogoPreview();
  }
  function updateLogoPreview() {
    var wrap = document.querySelector('.logo-preview-wrap');
    var image = document.getElementById('logoPreview');
    if (state.settings.logo) {
      image.src = state.settings.logo;
      wrap.classList.add('has-logo');
    } else {
      image.removeAttribute('src');
      wrap.classList.remove('has-logo');
    }
  }
  function saveSettings() {
    var name = document.getElementById('settingName').value.trim();
    var prefix = document.getElementById('settingPrefix').value.trim().replace(/[^a-z0-9]/gi, '').slice(0, 10);
    if (!name) { showToast('Enter the business name.', true); return; }
    if (!prefix) { showToast('Enter a short invoice prefix.', true); return; }
    state.settings.name = name;
    state.settings.address = document.getElementById('settingAddress').value.trim();
    state.settings.email = document.getElementById('settingEmail').value.trim();
    state.settings.phones = document.getElementById('settingPhones').value.trim();
    state.settings.tagline = document.getElementById('settingTagline').value.trim();
    state.settings.prefix = prefix.toUpperCase();
    if (persist()) {
      setBrand();
      if (document.getElementById('invoiceNumber').value && !state.invoices.some(function (invoice) { return invoice.number === document.getElementById('invoiceNumber').value; })) {
        document.getElementById('invoiceNumber').value = nextInvoiceNumber();
      }
      showToast('Company details saved.');
    }
  }
  function importLogo(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var image = new Image();
      image.onload = function () {
        var scale = Math.min(1, 900 / Math.max(image.width, image.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        state.settings.logo = canvas.toDataURL('image/png');
        if (persist()) { updateLogoPreview(); setBrand(); showToast('Logo saved.'); }
      };
      image.onerror = function () { showToast('That image could not be opened.', true); };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function removeLogo() {
    state.settings.logo = '';
    if (persist()) { updateLogoPreview(); setBrand(); showToast('Logo removed.'); }
  }
  function printInvoice(invoice) {
    var settings = state.settings;
    var logo = settings.logo ? '<img class=\"print-logo\" src=\"' + esc(settings.logo) + '\" alt=\"Company logo\">' : '';
    var itemRows = (invoice.items || []).map(function (item) {
      var title = item.particulars || item.description || '';
      var detail = item.particulars ? item.description : '';
      return '<tr><td>' + esc(item.quantity) + '</td><td><strong>' + esc(title) + '</strong>' + (detail ? '<span class=\"print-description\">' + esc(detail).replace(/\n/g, '<br>') + '</span>' : '') + '</td><td>' + money(item.unitPrice) + '</td><td>' + money(item.total) + '</td></tr>';
    }).join('');
    var phones = esc(settings.phones || '').replace(/,\s*/g, ' · ');
    var customer = invoice.customer || {};
    document.getElementById('printRoot').innerHTML =
      '<article class=\"print-sheet\"><header class=\"print-head\"><div class=\"print-brand\">' + logo + '</div><div class=\"print-company\"><h2>' + esc(settings.name) + '</h2>' +
      (settings.address ? '<div>' + esc(settings.address) + '</div>' : '') + (settings.email ? '<div>' + esc(settings.email) + '</div>' : '') +
      (phones ? '<div>' + phones + '</div>' : '') + (settings.tagline ? '<div class=\"print-tagline\">' + esc(settings.tagline) + '</div>' : '') + '</div></header>' +
      '<hr class=\"print-rule\"><div class=\"print-customer\"><strong>' + esc(customer.name) + '</strong>' + (customer.address ? '<br>' + esc(customer.address) : '') +
      (customer.phone ? '<br>' + esc(customer.phone) : '') + (customer.email ? '<br>' + esc(customer.email) : '') + '</div>' +
      '<div class=\"print-title-row\"><h1>PROFORMA INVOICE</h1><div class=\"print-meta\"><div><strong>Quote</strong> &nbsp;' + esc(invoice.number) + '</div><div><strong>Date</strong> &nbsp;' + esc(dateLabel(invoice.date)) + '</div></div></div>' +
      '<table class=\"print-table\"><thead><tr><th>Quantity</th><th>Particulars</th><th>Unit price (UGX)</th><th>Total price (UGX)</th></tr></thead><tbody>' + itemRows + '</tbody></table>' +
      '<div class=\"print-total\"><span>TOTAL (UGX)</span><span>' + money(invoice.total) + '</span></div>' +
      (invoice.notes ? '<div class=\"print-notes\"><strong>Notes</strong><br>' + esc(invoice.notes).replace(/\n/g, '<br>') + '</div>' : '') +
      '</article>';
    window.setTimeout(function () {
      window.print();
      window.setTimeout(function () { document.getElementById('printRoot').innerHTML = ''; }, 700);
    }, 80);
  }
  function exportBackup() {
    var payload = {application:'Proforma Invoice System', version:1, exportedAt:new Date().toISOString(), data:state};
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'proforma-backup-' + todayISO() + '.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    showToast('Backup downloaded.');
  }
  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var backup = JSON.parse(reader.result);
        var data = backup.data || backup;
        if (!Array.isArray(data.customers) || !Array.isArray(data.products) || !Array.isArray(data.invoices) || !data.settings) throw new Error('This file does not look like an invoice backup.');
        if (!window.confirm('Import this backup and replace the records currently in this browser?')) return;
        state = {
          settings:Object.assign({}, defaults.settings, data.settings),
          customers:data.customers,
          products:data.products,
          invoices:data.invoices,
          nextNumber:Number(data.nextNumber) || defaults.nextNumber
        };
        var numbering = normalizeQuoteNumbering(state.settings, state.invoices, state.nextNumber);
        state.settings = numbering.settings;
        state.nextNumber = numbering.nextNumber;
        if (persist()) { setBrand(); resetInvoice(); renderDashboard(); renderCustomers(); renderProducts(); showToast('Backup restored.'); }
      } catch (error) { showToast(error.message || 'Could not read this backup file.', true); }
    };
    reader.readAsText(file);
  }

  document.addEventListener('click', function (event) {
    var resetButton = event.target.closest('[data-reset-invoice]');
    if (resetButton) { resetInvoice(); go('dashboard'); return; }
    var pageButton = event.target.closest('[data-page], [data-goto]');
    if (pageButton) { go(pageButton.dataset.page || pageButton.dataset.goto); return; }
    if (event.target.closest('#addLine')) { addLine(); return; }
    if (event.target.closest('#saveInvoice')) { saveInvoice(); return; }
    if (event.target.closest('#printDraft')) {
      if (!draftItems.length) { showToast('Add at least one item before printing.', true); return; }
      var customer = state.customers.find(function (entry) { return entry.id === document.getElementById('invoiceCustomer').value; });
      if (!customer) { showToast('Choose a customer before printing.', true); return; }
      printInvoice({number:document.getElementById('invoiceNumber').value, date:document.getElementById('invoiceDate').value || todayISO(), customer:customer, items:draftItems, total:draftItems.reduce(function (sum, item) { return sum + item.total; }, 0), notes:document.getElementById('invoiceNotes').value});
      return;
    }
    if (event.target.closest('#addCustomer')) { openCustomerDialog(); return; }
    if (event.target.closest('#quickAddCustomer')) { openCustomerDialog(); return; }
    if (event.target.closest('#addProduct')) { openProductDialog(); return; }
    if (event.target.closest('#saveSettings')) { saveSettings(); return; }
    if (event.target.closest('#saveCloudConfig')) { saveCloudConfig(); return; }
    if (event.target.closest('#cloudSignIn')) { cloudAuth(false); return; }
    if (event.target.closest('#cloudSignUp')) { cloudAuth(true); return; }
    if (event.target.closest('#cloudSyncNow')) { syncCloud(); return; }
    if (event.target.closest('#cloudSignOut')) {
      cloudConfig.accessToken = ''; cloudConfig.refreshToken = ''; cloudConfig.userId = '';
      localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudConfig)); prepareCloudForm();
      showToast('Signed out. This device still has its saved records.'); return;
    }
    if (event.target.closest('#removeLogo')) { removeLogo(); return; }
    if (event.target.closest('#exportBackup')) { exportBackup(); return; }
    var removeLine = event.target.closest('[data-remove-line]');
    if (removeLine) { draftItems = draftItems.filter(function (item) { return item.id !== removeLine.dataset.removeLine; }); renderDraftItems(); return; }
    var printButton = event.target.closest('[data-print-invoice]');
    if (printButton) { var invoice = state.invoices.find(function (entry) { return entry.id === printButton.dataset.printInvoice; }); if (invoice) printInvoice(invoice); return; }
    var deleteInvoice = event.target.closest('[data-delete-invoice]');
    if (deleteInvoice) {
      if (window.confirm('Delete this saved invoice? This cannot be undone.')) {
        state.invoices = state.invoices.filter(function (entry) { return entry.id !== deleteInvoice.dataset.deleteInvoice; });
        persist(); renderHistory(); renderDashboard(); showToast('Invoice deleted.');
      }
      return;
    }
    var editCustomer = event.target.closest('[data-edit-customer]');
    if (editCustomer) { openCustomerDialog(state.customers.find(function (entry) { return entry.id === editCustomer.dataset.editCustomer; })); return; }
    var deleteCustomer = event.target.closest('[data-delete-customer]');
    if (deleteCustomer) {
      if (window.confirm('Delete this customer from your list? Existing invoices keep their saved customer details.')) {
        state.customers = state.customers.filter(function (entry) { return entry.id !== deleteCustomer.dataset.deleteCustomer; });
        persist(); renderCustomers(); fillInvoiceCustomers(); renderDashboard(); showToast('Customer deleted.');
      }
      return;
    }
    var editProduct = event.target.closest('[data-edit-product]');
    if (editProduct) { openProductDialog(state.products.find(function (entry) { return entry.id === editProduct.dataset.editProduct; })); return; }
    var deleteProduct = event.target.closest('[data-delete-product]');
    if (deleteProduct) {
      if (window.confirm('Delete this product from your catalog? Existing invoices are unchanged.')) {
        state.products = state.products.filter(function (entry) { return entry.id !== deleteProduct.dataset.deleteProduct; });
        persist(); renderProducts(); fillProductOptions(); showToast('Product deleted.');
      }
    }
  });
  document.getElementById('customerForm').addEventListener('submit', saveCustomer);
  document.getElementById('productForm').addEventListener('submit', saveProduct);
  document.getElementById('historySearch').addEventListener('input', renderHistory);
  document.getElementById('settingLogo').addEventListener('change', function (event) { importLogo(event.target.files[0]); event.target.value = ''; });
  document.getElementById('importBackup').addEventListener('change', function (event) { importBackup(event.target.files[0]); event.target.value = ''; });
  prepareCloudForm();
  document.getElementById('itemParticulars').addEventListener('change', function () {
    var product = state.products.find(function (entry) { return entry.name.toLowerCase() === document.getElementById('itemParticulars').value.trim().toLowerCase(); });
    if (product) document.getElementById('itemPrice').value = product.price;
  });

  setBrand();
  fillProductOptions();
  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('en-UG', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  renderDashboard();
  restoreCloudSession();
  document.querySelectorAll('[data-page]').forEach(function (element) {
    if (element.classList.contains('active')) go(element.dataset.page);
  });
}());
