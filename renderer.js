const { ipcRenderer } = require('electron');

// ========== المتغيرات العامة ==========
let currentUser = null;
let currentCompany = null;
let currentShift = null;
let cart = [];
let totalSalesCash = 0;
let currentCategory = 'all';
let selectedPayment = 'cash';
let currentShiftId = null;
let taxRate = 0;
let currentOrderType = 'local';
let userDataPath = '';

// ========== جلب مسار userData مرة واحدة ==========
async function initAppData() {
    userDataPath = await ipcRenderer.invoke('get-user-data-path');
}
initAppData();

// ========== مستمع الطباعة الاحتياطية من main.js ==========
ipcRenderer.on('fallback-print', (event, html) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    }
});

// ========== تسجيل الدخول ==========
async function submitLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return alert('أدخل اسم المستخدم وكلمة المرور');

    try {
        const result = await ipcRenderer.invoke('login', { username, password });
        if (!result.success) {
            alert(result.error || 'بيانات الدخول خاطئة');
            return;
        }
        currentUser = result.user;
        document.getElementById('current-user-display').innerText = currentUser.full_name;
        document.getElementById('user-role-badge').innerText = currentUser.role;

        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-main').style.display = 'flex';

        await loadCompanyData();
        const settings = await ipcRenderer.invoke('get-settings', currentCompany.id);
        window.appSettings = settings || {};

        await openShiftIfNeeded();

        const company = await ipcRenderer.invoke('get-company');
        taxRate = company ? company.tax_rate || 0 : 0;

        if (!currentCompany.name || currentCompany.name === 'مطعم تقنيات سوفت') {
            openCompanyModal();
        } else {
            switchTab('dashboard');
        }
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        alert('حدث خطأ أثناء الاتصال بقاعدة البيانات: ' + error.message);
    }
}

// ========== تحميل بيانات الشركة ==========
async function loadCompanyData() {
    try {
        const company = await ipcRenderer.invoke('get-company');
        if (company) {
            currentCompany = company;
            taxRate = company.tax_rate || 0;
        } else {
            currentCompany = { id: 1, name: 'مطعم تقنيات سوفت', phone: '', address: '', tax_rate: 0 };
            taxRate = 0;
        }
    } catch (error) {
        console.error('خطأ في loadCompanyData:', error);
        currentCompany = { id: 1, name: 'مطعم تقنيات سوفت', phone: '', address: '', tax_rate: 0 };
    }
}

// ========== فتح الوردية ==========
async function openShiftIfNeeded() {
    try {
        const openShift = await ipcRenderer.invoke('db-get',
            "SELECT * FROM shifts WHERE company_id=? AND status='open' ORDER BY id DESC LIMIT 1",
            [currentCompany.id]);
        if (openShift) {
            currentShift = openShift;
            currentShiftId = openShift.id;
        } else {
            const cash = prompt('أدخل رصيد الصندوق الافتتاحي:', '0');
            if (cash !== null) {
                const result = await ipcRenderer.invoke('db-run',
                    "INSERT INTO shifts (company_id, user_id, opening_cash, date, status) VALUES (?,?,?,?,?)",
                    [currentCompany.id, currentUser.id, parseFloat(cash) || 0,
                     new Date().toISOString().slice(0,10), 'open']);
                currentShiftId = result.lastInsertRowid;
                currentShift = { id: currentShiftId, opening_cash: parseFloat(cash) || 0 };
            }
        }
    } catch (error) {
        console.error('خطأ في openShiftIfNeeded:', error);
    }
}

// ========== فتح مودال بيانات الشركة ==========
function openCompanyModal() {
    document.getElementById('company-name').value = currentCompany.name || '';
    document.getElementById('company-phone').value = currentCompany.phone || '';
    document.getElementById('company-address').value = currentCompany.address || '';
    document.getElementById('company-tax').value = currentCompany.tax_number || '';
    document.getElementById('company-tax-rate').value = currentCompany.tax_rate || 0;
    document.getElementById('company-modal').style.display = 'flex';
}

async function saveCompanyFromModal() {
    const name = document.getElementById('company-name').value.trim();
    const phone = document.getElementById('company-phone').value.trim();
    const address = document.getElementById('company-address').value.trim();
    const tax_number = document.getElementById('company-tax').value.trim();
    const tax_rate = parseFloat(document.getElementById('company-tax-rate').value) || 0;

    if (!name) return alert('أدخل اسم المطعم');

    const result = await ipcRenderer.invoke('update-company', {
        name, phone, address, tax_number, tax_rate, userId: currentUser.id
    });
    if (result.success) {
        currentCompany.name = name;
        currentCompany.phone = phone;
        currentCompany.address = address;
        currentCompany.tax_number = tax_number;
        currentCompany.tax_rate = tax_rate;
        taxRate = tax_rate;
        document.getElementById('company-modal').style.display = 'none';
        switchTab('dashboard');
    } else {
        alert('خطأ في الحفظ: ' + result.error);
    }
}

// ========== تبديل التبويبات ==========
function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // التحقق من الصلاحيات
    const perms = currentUser.permissions || {};
    const restrictedTabs = {
        'products': perms.can_edit_products,
        'categories': perms.can_edit_products,
        'materials': perms.can_edit_products,
        'users': perms.can_edit_users,
        'reports': perms.can_view_reports,
        'expenses': perms.can_view_reports,
        'audit': perms.can_edit_users,
        'settings': currentUser.role === 'admin'
    };

    if (restrictedTabs[tabName] === 0) {
        document.getElementById('main-content').innerHTML =
            '<div style="padding:40px;text-align:center;color:#e74c3c;font-size:20px;"><i class="fas fa-lock fa-3x"></i><br><br>ليس لديك صلاحية للوصول لهذا القسم</div>';
        return;
    }

    switch(tabName) {
        case 'dashboard': loadDashboard(); break;
        case 'pos': loadPOS(); break;
        case 'products': loadProducts(); break;
        case 'categories': loadCategories(); break;
        case 'materials': loadMaterials(); break;
        case 'tables': loadTables(); break;
        case 'waiters': loadWaiters(); break;
        case 'reports': loadReports(); break;
        case 'expenses': loadExpenses(); break;
        case 'audit': loadAuditLog(); break;
        case 'users': loadUsers(); break;
        case 'settings': loadSettings(); break;
        default: loadDashboard();
    }
}

// ========== ربط أزرار القائمة الجانبية ==========
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

// ========== لوحة التحكم ==========
async function loadDashboard() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
    try {
        const today = new Date().toISOString().slice(0, 10);
        const [todaySales, totalOrders, totalProducts, lowStock] = await Promise.all([
            ipcRenderer.invoke('db-get', "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE company_id=? AND date=? AND status='completed'", [currentCompany.id, today]),
            ipcRenderer.invoke('db-get', "SELECT COUNT(*) as cnt FROM orders WHERE company_id=? AND date=? AND status='completed'", [currentCompany.id, today]),
            ipcRenderer.invoke('db-get', "SELECT COUNT(*) as cnt FROM products WHERE company_id=?", [currentCompany.id]),
            ipcRenderer.invoke('db-query', "SELECT * FROM raw_materials WHERE company_id=? AND current_stock <= min_stock", [currentCompany.id])
        ]);

        const recentOrders = await ipcRenderer.invoke('db-query',
            "SELECT o.*, u.full_name FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.company_id=? ORDER BY o.id DESC LIMIT 10",
            [currentCompany.id]);

        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-tachometer-alt"></i> لوحة التحكم</h1>
                <span style="color:#7f8c8d;">اليوم: ${today}</span>
            </div>
            ${currentShift ? `<div class="shift-info-box"><span>الوردية الحالية #${currentShift.id}</span><span>رصيد افتتاحي: ${(currentShift.opening_cash||0).toFixed(2)}</span></div>` : ''}
            ${lowStock.length > 0 ? `<div class="alert-warning"><i class="fas fa-exclamation-triangle"></i> تحذير: ${lowStock.length} مادة خام وصلت للحد الأدنى</div>` : ''}
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="stat-info"><h3>مبيعات اليوم</h3><p>${(todaySales.total||0).toFixed(2)}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-receipt"></i></div>
                    <div class="stat-info"><h3>طلبات اليوم</h3><p>${totalOrders.cnt||0}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-boxes"></i></div>
                    <div class="stat-info"><h3>المنتجات</h3><p>${totalProducts.cnt||0}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="color:#e74c3c;"><i class="fas fa-exclamation-circle"></i></div>
                    <div class="stat-info"><h3>تنبيهات المخزون</h3><p>${lowStock.length}</p></div>
                </div>
            </div>
            <h3 style="margin-bottom:10px;">آخر الطلبات</h3>
            <table>
                <thead><tr><th>#</th><th>التاريخ</th><th>الوقت</th><th>المبلغ</th><th>الدفع</th><th>الكاشير</th></tr></thead>
                <tbody>
                    ${recentOrders.map(o => `
                        <tr>
                            <td>${o.id}</td>
                            <td>${o.date||''}</td>
                            <td>${o.time||''}</td>
                            <td>${(o.total_with_tax||0).toFixed(2)}</td>
                            <td>${o.payment_method==='cash'?'نقدي':'شبكة'}</td>
                            <td>${o.full_name||'-'}</td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ في تحميل لوحة التحكم: ${error.message}</div>`;
    }
}

// ========== نقطة البيع POS ==========
async function loadPOS() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const [categories, products, tables, waiters] = await Promise.all([
            ipcRenderer.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id]),
            ipcRenderer.invoke('db-query', "SELECT * FROM products WHERE company_id=?", [currentCompany.id]),
            ipcRenderer.invoke('db-query', "SELECT * FROM tables WHERE company_id=?", [currentCompany.id]),
            ipcRenderer.invoke('db-query', "SELECT * FROM waiters WHERE company_id=?", [currentCompany.id])
        ]);

        cart = [];
        renderPOS(categories, products, tables, waiters);
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ في تحميل نقطة البيع: ${error.message}</div>`;
    }
}

function renderPOS(categories, products, tables, waiters) {
    const content = document.getElementById('main-content');
    content.innerHTML = `
        <div class="page-header">
            <h1><i class="fas fa-cash-register"></i> نقطة البيع</h1>
            <div style="display:flex;gap:8px;align-items:center;">
                <button class="btn btn-warning" onclick="openRefundModal()"><i class="fas fa-undo"></i> إرجاع</button>
                ${(currentUser.permissions?.can_close_shift) ? '<button class="btn btn-danger" onclick="closeShift()"><i class="fas fa-door-closed"></i> إغلاق الوردية</button>' : ''}
            </div>
        </div>
        <div class="pos-container">
            <div class="menu-section">
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <button class="type-btn btn active" id="type-local" onclick="setOrderType('local',this)"><i class="fas fa-chair"></i> محلي</button>
                    <button class="type-btn btn" id="type-takeaway" onclick="setOrderType('takeaway',this)"><i class="fas fa-bag-shopping"></i> تيك اواي</button>
                    <button class="type-btn btn" id="type-delivery" onclick="setOrderType('delivery',this)"><i class="fas fa-motorcycle"></i> توصيل</button>
                </div>
                <div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;">
                    <select id="pos-table" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                        <option value="">-- اختر طاولة --</option>
                        ${tables.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                    </select>
                    <select id="pos-waiter" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                        <option value="">-- اختر كابتن --</option>
                        ${waiters.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
                    </select>
                    <input type="text" id="pos-search" placeholder="بحث عن منتج..." oninput="filterPOSProducts()" style="padding:6px;border:1px solid #ddd;border-radius:6px;flex:1;">
                </div>
                <div class="category-grid">
                    <button class="cat-btn active" onclick="filterCategory('all', this)">الكل</button>
                    ${categories.map(c => `<button class="cat-btn" onclick="filterCategory(${c.id}, this)">${c.name}</button>`).join('')}
                </div>
                <div class="items-grid" id="pos-items">
                    ${renderProductCards(products)}
                </div>
            </div>
            <div class="invoice-section">
                <h3 style="margin-bottom:10px;"><i class="fas fa-receipt"></i> الفاتورة</h3>
                <div class="cart-items" id="cart-items"></div>
                <div style="margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span>المجموع:</span><span id="subtotal">0.00</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;" id="tax-row">
                        <span>الضريبة (${taxRate}%):</span><span id="tax-amount">0.00</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span>خصم:</span>
                        <input type="number" id="discount-input" value="0" min="0" style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px;" oninput="updateCartTotals()">
                    </div>
                    <div class="cart-total" style="display:flex;justify-content:space-between;">
                        <span>الإجمالي:</span><span id="grand-total">0.00</span>
                    </div>
                </div>
                <div class="payment-options">
                    <button id="pay-cash" class="active" onclick="setPayment('cash',this)"><i class="fas fa-money-bill"></i> نقدي</button>
                    <button id="pay-card" onclick="setPayment('card',this)"><i class="fas fa-credit-card"></i> شبكة</button>
                </div>
                <div id="cash-input-div" style="margin-bottom:8px;">
                    <label style="font-size:13px;">المبلغ المدفوع:</label>
                    <input type="number" id="paid-amount" placeholder="0.00" style="width:100%;padding:8px;border:2px solid #ddd;border-radius:6px;" oninput="calcChange()">
                    <div style="display:flex;justify-content:space-between;margin-top:4px;font-weight:700;">
                        <span>الباقي:</span><span id="change-amount" style="color:#27ae60;">0.00</span>
                    </div>
                </div>
                <button class="btn btn-success" style="width:100%;padding:14px;font-size:16px;" onclick="completeSale()"><i class="fas fa-check-circle"></i> إتمام البيع</button>
                <button class="btn btn-danger" style="width:100%;margin-top:5px;" onclick="clearCart()"><i class="fas fa-trash"></i> مسح الفاتورة</button>
            </div>
        </div>`;

    window._posProducts = products;
    window._posCategories = categories;
}

function renderProductCards(products) {
    if (!products || products.length === 0) return '<p style="text-align:center;color:#999;">لا توجد منتجات</p>';
    return products.map(p => `
        <div class="item-card" onclick="addToCart(${p.id},'${p.name.replace(/'/g,"\\'")}',${p.price})">
            <i class="fas fa-utensils fa-2x" style="color:#e67e22;margin-bottom:6px;"></i>
            <div style="font-weight:700;font-size:13px;">${p.name}</div>
            <div style="color:#e67e22;font-weight:800;">${p.price.toFixed(2)}</div>
        </div>`).join('');
}

function setOrderType(type, btn) {
    currentOrderType = type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function filterCategory(catId, btn) {
    currentCategory = catId;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filtered = catId === 'all' ? window._posProducts :
        window._posProducts.filter(p => p.category_id == catId);
    document.getElementById('pos-items').innerHTML = renderProductCards(filtered);
}

function filterPOSProducts() {
    const query = document.getElementById('pos-search').value.toLowerCase();
    const filtered = window._posProducts.filter(p => p.name.toLowerCase().includes(query));
    document.getElementById('pos-items').innerHTML = renderProductCards(filtered);
}

function addToCart(id, name, price) {
    const existing = cart.find(i => i.id === id);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ id, name, price, qty: 1 });
    }
    renderCart();
}

function renderCart() {
    const cartDiv = document.getElementById('cart-items');
    if (!cartDiv) return;
    if (cart.length === 0) {
        cartDiv.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">السلة فارغة</p>';
    } else {
        cartDiv.innerHTML = cart.map((item, idx) => `
            <div class="cart-item">
                <div style="flex:1;">
                    <div style="font-weight:700;">${item.name}</div>
                    <div style="font-size:13px;color:#7f8c8d;">${item.price.toFixed(2)} × ${item.qty} = ${(item.price * item.qty).toFixed(2)}</div>
                </div>
                <div style="display:flex;gap:4px;align-items:center;">
                    <button class="btn btn-sm btn-secondary" onclick="changeQty(${idx},-1)">-</button>
                    <span>${item.qty}</span>
                    <button class="btn btn-sm btn-secondary" onclick="changeQty(${idx},1)">+</button>
                    <button class="btn btn-sm btn-danger" onclick="removeFromCart(${idx})"><i class="fas fa-times"></i></button>
                </div>
            </div>`).join('');
    }
    updateCartTotals();
}

function changeQty(idx, delta) {
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    renderCart();
}

function removeFromCart(idx) {
    cart.splice(idx, 1);
    renderCart();
}

function clearCart() {
    cart = [];
    renderCart();
    const discountInput = document.getElementById('discount-input');
    if (discountInput) discountInput.value = 0;
}

function updateCartTotals() {
    const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const discount = parseFloat(document.getElementById('discount-input')?.value) || 0;
    const taxAmount = (subtotal - discount) * taxRate / 100;
    const grandTotal = subtotal - discount + taxAmount;

    if (document.getElementById('subtotal')) document.getElementById('subtotal').textContent = subtotal.toFixed(2);
    if (document.getElementById('tax-amount')) document.getElementById('tax-amount').textContent = taxAmount.toFixed(2);
    if (document.getElementById('grand-total')) document.getElementById('grand-total').textContent = grandTotal.toFixed(2);

    calcChange();
}

function setPayment(method, btn) {
    selectedPayment = method;
    document.querySelectorAll('.payment-options button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cashDiv = document.getElementById('cash-input-div');
    if (cashDiv) cashDiv.style.display = method === 'cash' ? 'block' : 'none';
}

function calcChange() {
    const grandTotal = parseFloat(document.getElementById('grand-total')?.textContent) || 0;
    const paid = parseFloat(document.getElementById('paid-amount')?.value) || 0;
    const change = paid - grandTotal;
    const el = document.getElementById('change-amount');
    if (el) {
        el.textContent = change >= 0 ? change.toFixed(2) : '0.00';
        el.style.color = change >= 0 ? '#27ae60' : '#e74c3c';
    }
}

async function completeSale() {
    if (cart.length === 0) return alert('السلة فارغة!');
    if (!currentShiftId) return alert('لا توجد وردية مفتوحة!');

    const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const discount = parseFloat(document.getElementById('discount-input')?.value) || 0;
    const taxAmount = (subtotal - discount) * taxRate / 100;
    const grandTotal = subtotal - discount + taxAmount;
    const paidAmount = selectedPayment === 'cash' ? (parseFloat(document.getElementById('paid-amount')?.value) || grandTotal) : grandTotal;
    const changeAmount = selectedPayment === 'cash' ? Math.max(0, paidAmount - grandTotal) : 0;

    if (selectedPayment === 'cash' && paidAmount < grandTotal) {
        return alert('المبلغ المدفوع أقل من الإجمالي!');
    }

    const now = new Date();
    const tableId = document.getElementById('pos-table')?.value || null;
    const waiterId = document.getElementById('pos-waiter')?.value || null;

    try {
        const orderResult = await ipcRenderer.invoke('db-run',
            "INSERT INTO orders (company_id, table_id, waiter_id, user_id, total, tax, total_with_tax, discount, payment_method, paid_amount, change_amount, date, time, shift_id, status, order_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?)",
            [currentCompany.id, tableId||null, waiterId||null, currentUser.id,
             subtotal, taxAmount, grandTotal, discount, selectedPayment,
             paidAmount, changeAmount,
             now.toISOString().slice(0,10),
             now.toTimeString().slice(0,5),
             currentShiftId, currentOrderType]);

        const orderId = orderResult.lastInsertRowid;

        for (const item of cart) {
            await ipcRenderer.invoke('db-run',
                "INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?,?,?,?)",
                [orderId, item.id, item.qty, item.price]);
        }

        // طباعة الفاتورة
        const receiptHtml = generateReceiptHTML(orderId, cart, subtotal, taxAmount, discount, grandTotal, paidAmount, changeAmount, now);
        await ipcRenderer.invoke('print-receipt', { html: receiptHtml, orderId });

        alert(`✅ تم البيع بنجاح!\nرقم الطلب: ${orderId}\nالإجمالي: ${grandTotal.toFixed(2)}\nالباقي: ${changeAmount.toFixed(2)}`);
        clearCart();
        if (document.getElementById('paid-amount')) document.getElementById('paid-amount').value = '';
    } catch (error) {
        console.error('خطأ في إتمام البيع:', error);
        alert('حدث خطأ: ' + error.message);
    }
}

function generateReceiptHTML(orderId, cartItems, subtotal, taxAmount, discount, grandTotal, paidAmount, changeAmount, now) {
    const company = currentCompany;
    return `
    <div style="width:74mm;font-family:Arial,sans-serif;direction:rtl;font-size:12px;">
        <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:5px;margin-bottom:5px;">
            <h2 style="margin:0;font-size:14px;">${company.name||'المطعم'}</h2>
            ${company.phone ? `<p style="margin:2px 0;">${company.phone}</p>` : ''}
            ${company.address ? `<p style="margin:2px 0;">${company.address}</p>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
            <span>رقم الطلب: ${orderId}</span>
            <span>${now.toISOString().slice(0,16).replace('T',' ')}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr><th style="text-align:right;">الصنف</th><th>كمية</th><th>سعر</th><th>مجموع</th></tr></thead>
            <tbody>
                ${cartItems.map(i => `<tr>
                    <td>${i.name}</td>
                    <td style="text-align:center;">${i.qty}</td>
                    <td style="text-align:center;">${i.price.toFixed(2)}</td>
                    <td style="text-align:center;">${(i.price*i.qty).toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <div style="border-top:1px dashed #000;margin-top:5px;padding-top:5px;">
            <div style="display:flex;justify-content:space-between;"><span>المجموع:</span><span>${subtotal.toFixed(2)}</span></div>
            ${discount > 0 ? `<div style="display:flex;justify-content:space-between;"><span>خصم:</span><span>${discount.toFixed(2)}</span></div>` : ''}
            ${taxAmount > 0 ? `<div style="display:flex;justify-content:space-between;"><span>ضريبة (${taxRate}%):</span><span>${taxAmount.toFixed(2)}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;border-top:1px solid #000;margin-top:3px;padding-top:3px;"><span>الإجمالي:</span><span>${grandTotal.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>المدفوع:</span><span>${paidAmount.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>الباقي:</span><span>${changeAmount.toFixed(2)}</span></div>
        </div>
        <div style="text-align:center;margin-top:8px;font-size:11px;">شكراً لزيارتكم</div>
    </div>`;
}

// ========== المنتجات ==========
async function loadProducts() {
    const content = document.getElementById('main-content');
    try {
        const [products, categories] = await Promise.all([
            ipcRenderer.invoke('db-query', "SELECT p.*, c.name as cat_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.company_id=?", [currentCompany.id]),
            ipcRenderer.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id])
        ]);

        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-boxes"></i> المنتجات</h1>
                <button class="btn btn-primary" onclick="openProductModal(null, ${JSON.stringify(categories).replace(/"/g,'&quot;')})"><i class="fas fa-plus"></i> إضافة منتج</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>الاسم</th><th>القسم</th><th>السعر</th><th>التكلفة</th><th>الوحدة</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${products.map(p => `<tr>
                        <td>${p.id}</td>
                        <td>${p.name}</td>
                        <td>${p.cat_name||'-'}</td>
                        <td>${p.price.toFixed(2)}</td>
                        <td>${(p.cost||0).toFixed(2)}</td>
                        <td>${p.unit||'قطعة'}</td>
                        <td>
                            <button class="btn btn-sm btn-warning" onclick='openProductModal(${JSON.stringify(p).replace(/'/g,"\\'")})'><i class="fas fa-edit"></i></button>
                            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        window._categories = categories;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

function openProductModal(product, categories) {
    if (!categories) categories = window._categories || [];
    const isEdit = product && product.id;
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3 style="margin-bottom:15px;">${isEdit ? 'تعديل منتج' : 'إضافة منتج'}</h3>
        <div class="form-group"><label>اسم المنتج</label><input type="text" id="p-name" value="${isEdit ? product.name : ''}"></div>
        <div class="form-group"><label>القسم</label>
            <select id="p-cat">
                <option value="">-- اختر قسم --</option>
                ${categories.map(c => `<option value="${c.id}" ${isEdit && product.category_id==c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>السعر</label><input type="number" id="p-price" value="${isEdit ? product.price : ''}" step="0.01"></div>
        <div class="form-group"><label>التكلفة</label><input type="number" id="p-cost" value="${isEdit ? product.cost||0 : 0}" step="0.01"></div>
        <div class="form-group"><label>الوحدة</label><input type="text" id="p-unit" value="${isEdit ? product.unit||'قطعة' : 'قطعة'}"></div>
        <div class="form-group"><label>الباركود</label><input type="text" id="p-barcode" value="${isEdit ? product.barcode||'' : ''}"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="saveProduct(${isEdit ? product.id : 'null'})">حفظ</button>
        <button class="btn btn-secondary" style="width:100%;margin-top:5px;" onclick="closeModal()">إلغاء</button>`;
    document.getElementById('modal').classList.add('active');
}

async function saveProduct(id) {
    const name = document.getElementById('p-name').value.trim();
    const price = parseFloat(document.getElementById('p-price').value) || 0;
    const cost = parseFloat(document.getElementById('p-cost').value) || 0;
    const category_id = document.getElementById('p-cat').value || null;
    const unit = document.getElementById('p-unit').value || 'قطعة';
    const barcode = document.getElementById('p-barcode').value || '';

    if (!name || !price) return alert('أدخل اسم المنتج والسعر');

    const result = await ipcRenderer.invoke('save-product', {
        id, company_id: currentCompany.id, name, price, cost, category_id, unit, barcode,
        recipe: '', image: '', userId: currentUser.id
    });
    if (result.success) {
        closeModal();
        loadProducts();
    } else {
        alert('خطأ: ' + result.error);
    }
}

async function deleteProduct(id) {
    if (!confirm('هل تريد حذف هذا المنتج؟')) return;
    const result = await ipcRenderer.invoke('delete-product', { id, company_id: currentCompany.id, userId: currentUser.id });
    if (result.success) loadProducts();
    else alert('خطأ في الحذف: ' + result.error);
}

// ========== الأقسام ==========
async function loadCategories() {
    const content = document.getElementById('main-content');
    try {
        const categories = await ipcRenderer.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id]);
        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-tags"></i> الأقسام</h1>
                <button class="btn btn-primary" onclick="addCategory()"><i class="fas fa-plus"></i> إضافة قسم</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>اسم القسم</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${categories.map(c => `<tr>
                        <td>${c.id}</td>
                        <td>${c.name}</td>
                        <td><button class="btn btn-sm btn-danger" onclick="deleteCategory(${c.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

async function addCategory() {
    const name = prompt('اسم القسم الجديد:');
    if (!name) return;
    const result = await ipcRenderer.invoke('save-category', { company_id: currentCompany.id, name, userId: currentUser.id });
    if (result.success) loadCategories();
    else alert('خطأ: ' + result.error);
}

async function deleteCategory(id) {
    if (!confirm('هل تريد حذف هذا القسم؟')) return;
    const result = await ipcRenderer.invoke('delete-category', { id, userId: currentUser.id });
    if (result.success) loadCategories();
    else alert('خطأ: ' + result.error);
}

// ========== المواد الخام ==========
async function loadMaterials() {
    const content = document.getElementById('main-content');
    try {
        const materials = await ipcRenderer.invoke('db-query', "SELECT * FROM raw_materials WHERE company_id=?", [currentCompany.id]);
        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-cubes"></i> المواد الخام</h1>
                <button class="btn btn-primary" onclick="openMaterialModal(null)"><i class="fas fa-plus"></i> إضافة مادة</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>الاسم</th><th>الوحدة</th><th>المخزون الحالي</th><th>الحد الأدنى</th><th>سعر الشراء</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${materials.map(m => `<tr class="${m.current_stock <= m.min_stock ? 'stock-danger' : ''}">
                        <td>${m.id}</td>
                        <td>${m.name}</td>
                        <td>${m.unit}</td>
                        <td>${m.current_stock}</td>
                        <td>${m.min_stock}</td>
                        <td>${m.purchase_price}</td>
                        <td>
                            <button class="btn btn-sm btn-success" onclick="addStock(${m.id})"><i class="fas fa-plus-circle"></i> توريد</button>
                            <button class="btn btn-sm btn-warning" onclick="openMaterialModal(${JSON.stringify(m).replace(/"/g,'&quot;')})"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-sm btn-danger" onclick="deleteMaterial(${m.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

function openMaterialModal(material) {
    const isEdit = material && material.id;
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3 style="margin-bottom:15px;">${isEdit ? 'تعديل مادة' : 'إضافة مادة خام'}</h3>
        <div class="form-group"><label>الاسم</label><input type="text" id="m-name" value="${isEdit ? material.name : ''}"></div>
        <div class="form-group"><label>الوحدة</label><input type="text" id="m-unit" value="${isEdit ? material.unit : 'كغ'}"></div>
        <div class="form-group"><label>الحد الأدنى</label><input type="number" id="m-min" value="${isEdit ? material.min_stock : 0}" step="0.01"></div>
        <div class="form-group"><label>سعر الشراء</label><input type="number" id="m-price" value="${isEdit ? material.purchase_price : 0}" step="0.01"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="saveMaterial(${isEdit ? material.id : 'null'})">حفظ</button>
        <button class="btn btn-secondary" style="width:100%;margin-top:5px;" onclick="closeModal()">إلغاء</button>`;
    document.getElementById('modal').classList.add('active');
}

async function saveMaterial(id) {
    const name = document.getElementById('m-name').value.trim();
    const unit = document.getElementById('m-unit').value || 'كغ';
    const min_stock = parseFloat(document.getElementById('m-min').value) || 0;
    const purchase_price = parseFloat(document.getElementById('m-price').value) || 0;
    if (!name) return alert('أدخل اسم المادة');
    const result = await ipcRenderer.invoke('save-material', { id, company_id: currentCompany.id, name, unit, min_stock, purchase_price });
    if (result.success) { closeModal(); loadMaterials(); }
    else alert('خطأ: ' + result.error);
}

async function addStock(materialId) {
    const qty = parseFloat(prompt('أدخل الكمية المضافة:'));
    if (isNaN(qty) || qty <= 0) return;
    const result = await ipcRenderer.invoke('add-stock', { material_id: materialId, qty, userId: currentUser.id });
    if (result.success) loadMaterials();
    else alert('خطأ: ' + result.error);
}

async function deleteMaterial(id) {
    if (!confirm('حذف هذه المادة؟')) return;
    const result = await ipcRenderer.invoke('delete-material', { id, company_id: currentCompany.id });
    if (result.success) loadMaterials();
    else alert('خطأ: ' + result.error);
}

// ========== الطاولات ==========
async function loadTables() {
    const content = document.getElementById('main-content');
    try {
        const tables = await ipcRenderer.invoke('db-query', "SELECT * FROM tables WHERE company_id=?", [currentCompany.id]);
        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-chair"></i> الطاولات</h1>
                <button class="btn btn-primary" onclick="addTable()"><i class="fas fa-plus"></i> إضافة طاولة</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>اسم الطاولة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${tables.map(t => `<tr>
                        <td>${t.id}</td>
                        <td>${t.name}</td>
                        <td><span class="badge">${t.status === 'free' ? 'فارغة' : 'مشغولة'}</span></td>
                        <td><button class="btn btn-sm btn-danger" onclick="deleteTable(${t.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

async function addTable() {
    const name = prompt('اسم الطاولة (مثال: طاولة 1):');
    if (!name) return;
    const result = await ipcRenderer.invoke('save-table', { company_id: currentCompany.id, name });
    if (result.success) loadTables();
    else alert('خطأ: ' + result.error);
}

async function deleteTable(id) {
    if (!confirm('حذف هذه الطاولة؟')) return;
    const result = await ipcRenderer.invoke('delete-table', { id });
    if (result.success) loadTables();
    else alert('خطأ: ' + result.error);
}

// ========== الكباتن (النوادل) ==========
async function loadWaiters() {
    const content = document.getElementById('main-content');
    try {
        const waiters = await ipcRenderer.invoke('db-query', "SELECT * FROM waiters WHERE company_id=?", [currentCompany.id]);
        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-user-tie"></i> الكباتن</h1>
                <button class="btn btn-primary" onclick="addWaiter()"><i class="fas fa-plus"></i> إضافة كابتن</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>الاسم</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${waiters.map(w => `<tr>
                        <td>${w.id}</td>
                        <td>${w.name}</td>
                        <td><button class="btn btn-sm btn-danger" onclick="deleteWaiter(${w.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

async function addWaiter() {
    const name = prompt('اسم الكابتن:');
    if (!name) return;
    const result = await ipcRenderer.invoke('save-waiter', { company_id: currentCompany.id, name });
    if (result.success) loadWaiters();
    else alert('خطأ: ' + result.error);
}

async function deleteWaiter(id) {
    if (!confirm('حذف هذا الكابتن؟')) return;
    const result = await ipcRenderer.invoke('delete-waiter', { id });
    if (result.success) loadWaiters();
    else alert('خطأ: ' + result.error);
}

// ========== التقارير ==========
async function loadReports() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0,10);
    const firstDay = today.slice(0,8) + '01';

    content.innerHTML = `
        <div class="page-header"><h1><i class="fas fa-chart-line"></i> التقارير</h1></div>
        <div style="background:white;padding:15px;border-radius:8px;margin-bottom:15px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="form-group" style="margin:0;">
                    <label>من تاريخ</label>
                    <input type="date" id="report-from" value="${firstDay}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>إلى تاريخ</label>
                    <input type="date" id="report-to" value="${today}">
                </div>
                <button class="btn btn-primary" onclick="generateReport()"><i class="fas fa-search"></i> عرض التقرير</button>
            </div>
        </div>
        <div id="report-results"></div>`;
}

async function generateReport() {
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    if (!from || !to) return alert('اختر نطاق التاريخ');

    const resultsDiv = document.getElementById('report-results');
    resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const [orders, topProducts, cashSales, cardSales] = await Promise.all([
            ipcRenderer.invoke('db-query',
                "SELECT o.*, u.full_name FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.company_id=? AND o.date BETWEEN ? AND ? AND o.status='completed' ORDER BY o.id DESC",
                [currentCompany.id, from, to]),
            ipcRenderer.invoke('db-query',
                "SELECT p.name, SUM(oi.qty) as total_qty, SUM(oi.qty*oi.price) as total_amount FROM order_items oi JOIN orders o ON oi.order_id=o.id JOIN products p ON oi.product_id=p.id WHERE o.company_id=? AND o.date BETWEEN ? AND ? AND o.status='completed' GROUP BY p.id ORDER BY total_qty DESC LIMIT 10",
                [currentCompany.id, from, to]),
            ipcRenderer.invoke('db-get',
                "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE company_id=? AND date BETWEEN ? AND ? AND payment_method='cash' AND status='completed'",
                [currentCompany.id, from, to]),
            ipcRenderer.invoke('db-get',
                "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE company_id=? AND date BETWEEN ? AND ? AND payment_method='card' AND status='completed'",
                [currentCompany.id, from, to])
        ]);

        const totalSales = orders.reduce((s, o) => s + (o.total_with_tax||0), 0);
        const totalTax = orders.reduce((s, o) => s + (o.tax||0), 0);
        const totalDiscount = orders.reduce((s, o) => s + (o.discount||0), 0);

        resultsDiv.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div><div class="stat-info"><h3>إجمالي المبيعات</h3><p>${totalSales.toFixed(2)}</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-receipt"></i></div><div class="stat-info"><h3>عدد الطلبات</h3><p>${orders.length}</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-money-bill"></i></div><div class="stat-info"><h3>مبيعات نقدي</h3><p>${(cashSales.total||0).toFixed(2)}</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-credit-card"></i></div><div class="stat-info"><h3>مبيعات شبكة</h3><p>${(cardSales.total||0).toFixed(2)}</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-percent"></i></div><div class="stat-info"><h3>إجمالي الضريبة</h3><p>${totalTax.toFixed(2)}</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-tag"></i></div><div class="stat-info"><h3>إجمالي الخصم</h3><p>${totalDiscount.toFixed(2)}</p></div></div>
            </div>
            <h3 style="margin:15px 0 8px;">أكثر المنتجات مبيعاً</h3>
            <table>
                <thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
                <tbody>
                    ${topProducts.map(p => `<tr><td>${p.name}</td><td>${p.total_qty}</td><td>${(p.total_amount||0).toFixed(2)}</td></tr>`).join('')}
                </tbody>
            </table>
            <h3 style="margin:15px 0 8px;">تفاصيل الطلبات</h3>
            <table>
                <thead><tr><th>#</th><th>التاريخ</th><th>الوقت</th><th>الإجمالي</th><th>الدفع</th><th>الكاشير</th></tr></thead>
                <tbody>
                    ${orders.map(o => `<tr>
                        <td>${o.id}</td><td>${o.date}</td><td>${o.time||''}</td>
                        <td>${(o.total_with_tax||0).toFixed(2)}</td>
                        <td>${o.payment_method==='cash'?'نقدي':'شبكة'}</td>
                        <td>${o.full_name||'-'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        resultsDiv.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

// ========== المصروفات ==========
async function loadExpenses() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0,10);
    try {
        const expenses = await ipcRenderer.invoke('db-query',
            "SELECT * FROM expenses WHERE company_id=? ORDER BY date DESC LIMIT 100",
            [currentCompany.id]);

        const total = expenses.reduce((s, e) => s + (e.amount||0), 0);

        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-money-bill-wave"></i> المصروفات</h1>
                <button class="btn btn-primary" onclick="openExpenseModal()"><i class="fas fa-plus"></i> إضافة مصروف</button>
            </div>
            <div class="stat-card" style="margin-bottom:15px;">
                <div class="stat-icon"><i class="fas fa-coins"></i></div>
                <div class="stat-info"><h3>إجمالي المصروفات</h3><p>${total.toFixed(2)}</p></div>
            </div>
            <table>
                <thead><tr><th>التاريخ</th><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th>النوع</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${expenses.map(e => `<tr>
                        <td>${e.date||''}</td>
                        <td>${e.category||''}</td>
                        <td>${e.description||''}</td>
                        <td>${(e.amount||0).toFixed(2)}</td>
                        <td>${e.type==='fixed'?'ثابت':'متغير'}</td>
                        <td><button class="btn btn-sm btn-danger" onclick="deleteExpense(${e.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

function openExpenseModal() {
    const modalContent = document.getElementById('modal-content');
    const today = new Date().toISOString().slice(0,10);
    modalContent.innerHTML = `
        <h3 style="margin-bottom:15px;">إضافة مصروف</h3>
        <div class="form-group"><label>الفئة</label>
            <select id="exp-cat">
                <option value="إيجار">إيجار</option>
                <option value="كهرباء">كهرباء</option>
                <option value="مياه">مياه</option>
                <option value="رواتب">رواتب</option>
                <option value="مواد">مواد</option>
                <option value="صيانة">صيانة</option>
                <option value="أخرى">أخرى</option>
            </select>
        </div>
        <div class="form-group"><label>الوصف</label><input type="text" id="exp-desc"></div>
        <div class="form-group"><label>المبلغ</label><input type="number" id="exp-amount" step="0.01"></div>
        <div class="form-group"><label>النوع</label>
            <select id="exp-type"><option value="fixed">ثابت</option><option value="variable">متغير</option></select>
        </div>
        <div class="form-group"><label>التاريخ</label><input type="date" id="exp-date" value="${today}"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="saveExpense()">حفظ</button>
        <button class="btn btn-secondary" style="width:100%;margin-top:5px;" onclick="closeModal()">إلغاء</button>`;
    document.getElementById('modal').classList.add('active');
}

async function saveExpense() {
    const category = document.getElementById('exp-cat').value;
    const description = document.getElementById('exp-desc').value;
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const type = document.getElementById('exp-type').value;
    const date = document.getElementById('exp-date').value;

    if (!amount || amount <= 0) return alert('أدخل المبلغ');

    const result = await ipcRenderer.invoke('db-run',
        "INSERT INTO expenses (company_id, category, description, amount, type, date, user_id, month) VALUES (?,?,?,?,?,?,?,?)",
        [currentCompany.id, category, description, amount, type, date, currentUser.id, date.slice(0,7)]);

    if (result.changes > 0) { closeModal(); loadExpenses(); }
    else alert('خطأ في الحفظ');
}

async function deleteExpense(id) {
    if (!confirm('حذف هذا المصروف؟')) return;
    await ipcRenderer.invoke('db-run', "DELETE FROM expenses WHERE id=?", [id]);
    loadExpenses();
}

// ========== سجل التدقيق ==========
async function loadAuditLog() {
    const content = document.getElementById('main-content');
    try {
        const logs = await ipcRenderer.invoke('get-audit-log', { limit: 200 });
        content.innerHTML = `
            <div class="page-header"><h1><i class="fas fa-history"></i> سجل التدقيق</h1></div>
            <table>
                <thead><tr><th>#</th><th>التاريخ</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead>
                <tbody>
                    ${logs.map(l => `<tr>
                        <td>${l.id}</td>
                        <td>${l.date||''}</td>
                        <td>${l.user_id||'-'}</td>
                        <td>${l.action||''}</td>
                        <td>${l.details||''}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

// ========== المستخدمين ==========
async function loadUsers() {
    const content = document.getElementById('main-content');
    try {
        const users = await ipcRenderer.invoke('db-query',
            "SELECT u.*, p.can_edit_products, p.can_view_reports FROM users u LEFT JOIN permissions p ON u.id=p.user_id WHERE u.company_id=?",
            [currentCompany.id]);

        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fas fa-users-cog"></i> المستخدمين</h1>
                <button class="btn btn-primary" onclick="openUserModal(null)"><i class="fas fa-plus"></i> إضافة مستخدم</button>
            </div>
            <table>
                <thead><tr><th>#</th><th>الاسم</th><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                <tbody>
                    ${users.map(u => `<tr>
                        <td>${u.id}</td>
                        <td>${u.full_name}</td>
                        <td>${u.username}</td>
                        <td>${u.role}</td>
                        <td><span class="badge" style="background:${u.is_blocked?'#e74c3c':'#27ae60'}">${u.is_blocked?'محظور':'نشط'}</span></td>
                        <td>
                            <button class="btn btn-sm btn-warning" onclick="openUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})"><i class="fas fa-edit"></i></button>
                            ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-secondary" onclick="toggleBlock(${u.id})">${u.is_blocked?'رفع الحظر':'حظر'}</button>` : ''}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div style="margin-top:15px;">
                <button class="btn btn-warning" onclick="document.getElementById('password-modal').style.display='flex'"><i class="fas fa-key"></i> تغيير كلمة المرور</button>
            </div>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

function openUserModal(user) {
    const isEdit = user && user.id;
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3 style="margin-bottom:15px;">${isEdit ? 'تعديل مستخدم' : 'إضافة مستخدم'}</h3>
        <div class="form-group"><label>الاسم الكامل</label><input type="text" id="u-fullname" value="${isEdit ? user.full_name : ''}"></div>
        <div class="form-group"><label>اسم المستخدم</label><input type="text" id="u-username" value="${isEdit ? user.username : ''}"></div>
        <div class="form-group"><label>كلمة المرور ${isEdit ? '(اتركها فارغة للإبقاء على الحالية)' : ''}</label><input type="password" id="u-password"></div>
        <div class="form-group"><label>الدور</label>
            <select id="u-role">
                <option value="admin" ${isEdit && user.role==='admin' ? 'selected' : ''}>مدير</option>
                <option value="accountant" ${isEdit && user.role==='accountant' ? 'selected' : ''}>محاسب</option>
                <option value="cashier" ${isEdit && user.role==='cashier' ? 'selected' : ''}>كاشير</option>
            </select>
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="saveUser(${isEdit ? user.id : 'null'})">حفظ</button>
        <button class="btn btn-secondary" style="width:100%;margin-top:5px;" onclick="closeModal()">إلغاء</button>`;
    document.getElementById('modal').classList.add('active');
}

async function saveUser(id) {
    const full_name = document.getElementById('u-fullname').value.trim();
    const username = document.getElementById('u-username').value.trim();
    const password = document.getElementById('u-password').value;
    const role = document.getElementById('u-role').value;

    if (!full_name || !username) return alert('أدخل الاسم واسم المستخدم');
    if (!id && !password) return alert('أدخل كلمة المرور للمستخدم الجديد');

    let result;
    if (id) {
        result = await ipcRenderer.invoke('update-user', { id, full_name, username, password, role, currentUserId: currentUser.id });
    } else {
        result = await ipcRenderer.invoke('create-user', { company_id: currentCompany.id, full_name, username, password, role, currentUserId: currentUser.id });
    }

    if (result.success) { closeModal(); loadUsers(); }
    else alert('خطأ: ' + result.error);
}

async function toggleBlock(userId) {
    const result = await ipcRenderer.invoke('toggle-block', { userId, currentUserId: currentUser.id });
    if (result.success) loadUsers();
    else alert('خطأ: ' + result.error);
}

async function changePassword() {
    const oldPass = document.getElementById('old-password').value;
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-password').value;

    if (!oldPass || !newPass || !confirmPass) return alert('أدخل جميع الحقول');
    if (newPass !== confirmPass) return alert('كلمة المرور الجديدة غير متطابقة');
    if (newPass.length < 4) return alert('كلمة المرور يجب أن تكون 4 أحرف على الأقل');

    const result = await ipcRenderer.invoke('update-user', {
        id: currentUser.id,
        full_name: currentUser.full_name,
        username: currentUser.username,
        password: newPass,
        role: currentUser.role,
        currentUserId: currentUser.id
    });

    if (result.success) {
        alert('تم تغيير كلمة المرور بنجاح');
        document.getElementById('password-modal').style.display = 'none';
        document.getElementById('old-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
    } else {
        alert('خطأ: ' + result.error);
    }
}

// ========== الإعدادات ==========
async function loadSettings() {
    const content = document.getElementById('main-content');
    try {
        const [company, settings] = await Promise.all([
            ipcRenderer.invoke('get-company'),
            ipcRenderer.invoke('get-settings', currentCompany.id)
        ]);

        content.innerHTML = `
            <div class="page-header"><h1><i class="fas fa-cog"></i> الإعدادات</h1></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div style="background:white;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                    <h3 style="margin-bottom:15px;"><i class="fas fa-store"></i> بيانات المطعم</h3>
                    <div class="form-group"><label>اسم المطعم</label><input type="text" id="s-name" value="${company?.name||''}"></div>
                    <div class="form-group"><label>الهاتف</label><input type="text" id="s-phone" value="${company?.phone||''}"></div>
                    <div class="form-group"><label>العنوان</label><input type="text" id="s-address" value="${company?.address||''}"></div>
                    <div class="form-group"><label>الرقم الضريبي</label><input type="text" id="s-taxnum" value="${company?.tax_number||''}"></div>
                    <div class="form-group"><label>نسبة الضريبة (%)</label><input type="number" id="s-taxrate" value="${company?.tax_rate||0}" step="0.01" min="0"></div>
                    <button class="btn btn-primary" onclick="saveCompanySettings()"><i class="fas fa-save"></i> حفظ بيانات المطعم</button>
                </div>
                <div style="background:white;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                    <h3 style="margin-bottom:15px;"><i class="fas fa-sliders-h"></i> إعدادات النظام</h3>
                    <div class="form-group">
                        <label>هامش الربح (%)</label>
                        <input type="number" id="s-profit" value="${settings?.profit_margin_percent||30}" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label>عدد الصفوف في الصفحة</label>
                        <input type="number" id="s-pagination" value="${settings?.pagination||20}" min="5" max="100">
                    </div>
                    <button class="btn btn-primary" onclick="saveSystemSettings()"><i class="fas fa-save"></i> حفظ إعدادات النظام</button>
                    <hr style="margin:15px 0;">
                    <h4 style="margin-bottom:10px;"><i class="fas fa-database"></i> النسخ الاحتياطي</h4>
                    <button class="btn btn-success" onclick="manualBackup()"><i class="fas fa-download"></i> نسخة احتياطية الآن</button>
                </div>
            </div>`;
    } catch (error) {
        content.innerHTML = `<div style="color:red;padding:20px;">خطأ: ${error.message}</div>`;
    }
}

async function saveCompanySettings() {
    const name = document.getElementById('s-name').value.trim();
    const phone = document.getElementById('s-phone').value.trim();
    const address = document.getElementById('s-address').value.trim();
    const tax_number = document.getElementById('s-taxnum').value.trim();
    const tax_rate = parseFloat(document.getElementById('s-taxrate').value) || 0;

    if (!name) return alert('أدخل اسم المطعم');
    const result = await ipcRenderer.invoke('update-company', { name, phone, address, tax_number, tax_rate, userId: currentUser.id });
    if (result.success) {
        taxRate = tax_rate;
        currentCompany.tax_rate = tax_rate;
        currentCompany.name = name;
        alert('تم الحفظ بنجاح');
    } else {
        alert('خطأ: ' + result.error);
    }
}

async function saveSystemSettings() {
    const profit_margin_percent = parseFloat(document.getElementById('s-profit').value) || 30;
    const pagination = parseInt(document.getElementById('s-pagination').value) || 20;
    const result = await ipcRenderer.invoke('save-settings', {
        companyId: currentCompany.id,
        settings: { profit_margin_percent, pagination },
        userId: currentUser.id
    });
    if (result.success) alert('تم حفظ الإعدادات');
    else alert('خطأ: ' + result.error);
}

async function manualBackup() {
    const result = await ipcRenderer.invoke('manual-backup');
    if (result.success) alert('✅ تم إنشاء النسخة الاحتياطية في:\n' + result.path);
    else alert('خطأ في النسخ الاحتياطي: ' + result.error);
}

// ========== إغلاق الوردية ==========
async function closeShift() {
    if (!currentShiftId) return alert('لا توجد وردية مفتوحة');
    const closingCash = parseFloat(prompt('أدخل المبلغ الفعلي في الصندوق:'));
    if (isNaN(closingCash)) return;

    const salesTotal = await ipcRenderer.invoke('db-get',
        "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE shift_id=? AND payment_method='cash' AND status='completed'",
        [currentShiftId]);

    const expectedCash = (currentShift?.opening_cash || 0) + (salesTotal?.total || 0);
    const difference = closingCash - expectedCash;

    await ipcRenderer.invoke('db-run',
        "UPDATE shifts SET closing_cash=?, expected_cash=?, cash_difference=?, status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?",
        [closingCash, expectedCash, difference, currentShiftId]);

    const reportHtml = `
    <div style="width:74mm;font-family:Arial;direction:rtl;font-size:12px;padding:5mm;">
        <h3 style="text-align:center;">تقرير إغلاق الوردية</h3>
        <p>الوردية #${currentShiftId}</p>
        <p>رصيد افتتاحي: ${(currentShift?.opening_cash||0).toFixed(2)}</p>
        <p>مبيعات نقدي: ${(salesTotal?.total||0).toFixed(2)}</p>
        <p>المتوقع في الصندوق: ${expectedCash.toFixed(2)}</p>
        <p>الفعلي في الصندوق: ${closingCash.toFixed(2)}</p>
        <p style="font-weight:bold;color:${difference>=0?'green':'red'}">الفرق: ${difference.toFixed(2)}</p>
    </div>`;

    const printDiv = document.getElementById('shift-report-receipt');
    if (printDiv) { printDiv.innerHTML = reportHtml; printDiv.style.display = 'block'; }
    window.print();
    setTimeout(() => { if (printDiv) printDiv.style.display = 'none'; }, 1000);

    alert(`تم إغلاق الوردية\nالفرق: ${difference.toFixed(2)}`);
    currentShift = null;
    currentShiftId = null;
    await openShiftIfNeeded();
}

// ========== الإرجاع ==========
function openRefundModal() {
    document.getElementById('refund-modal').style.display = 'flex';
}

async function processRefund() {
    const orderId = parseInt(document.getElementById('refund-order-id').value);
    const reason = document.getElementById('refund-reason').value.trim();

    if (!orderId) return alert('أدخل رقم الطلب');
    if (!reason) return alert('أدخل سبب الإرجاع');

    const order = await ipcRenderer.invoke('db-get', "SELECT * FROM orders WHERE id=? AND company_id=?", [orderId, currentCompany.id]);
    if (!order) return alert('الطلب غير موجود');
    if (order.status === 'refunded') return alert('هذا الطلب تم إرجاعه مسبقاً');

    const result = await ipcRenderer.invoke('process-refund', { orderId, reason, userId: currentUser.id });
    if (result.success) {
        alert(`✅ تم الإرجاع بنجاح\nالمبلغ المسترد: ${order.total_with_tax.toFixed(2)}`);
        document.getElementById('refund-modal').style.display = 'none';
        document.getElementById('refund-order-id').value = '';
        document.getElementById('refund-reason').value = '';
    } else {
        alert('خطأ في الإرجاع: ' + result.error);
    }
}

// ========== المودال العام ==========
function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) closeModal();
});

// ========== مفاتيح الاختصار ==========
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        document.getElementById('company-modal').style.display = 'none';
        document.getElementById('refund-modal').style.display = 'none';
        document.getElementById('password-modal').style.display = 'none';
    }
});

// ========== مستمع Enter في تسجيل الدخول ==========
document.getElementById('login-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitLogin();
});
