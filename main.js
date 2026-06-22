const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

// ========== إعداد pdfmake مع دعم الخطوط العربية ==========
const PdfPrinter = require('pdfmake');
const pdfFonts = {
    Tajawal: {
        normal: path.join(__dirname, 'assets/fonts/Tajawal-Regular.ttf'),
        bold: path.join(__dirname, 'assets/fonts/Tajawal-Bold.ttf'),
        italics: path.join(__dirname, 'assets/fonts/Tajawal-Regular.ttf'),
        bolditalics: path.join(__dirname, 'assets/fonts/Tajawal-Bold.ttf')
    },
    Roboto: {
        normal: path.join(__dirname, 'assets/fonts/Roboto-Regular.ttf'),
        bold: path.join(__dirname, 'assets/fonts/Roboto-Medium.ttf'),
        italics: path.join(__dirname, 'assets/fonts/Roboto-Italic.ttf'),
        bolditalics: path.join(__dirname, 'assets/fonts/Roboto-MediumItalic.ttf')
    }
};
const pdfMake = new PdfPrinter(pdfFonts);

let mainWindow;
let db;
const dbDir = app.getPath('userData');
const dbPath = path.join(dbDir, 'technologies_soft.db');
const backupDir = path.join(dbDir, 'backups');
const logsDir = path.join(dbDir, 'logs');
const imagesDir = path.join(dbDir, 'product-images');

// ========== إنشاء المجلدات ==========
function ensureDirectories() {
    try {
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
        return true;
    } catch (error) {
        console.error('فشل إنشاء المجلدات:', error);
        return false;
    }
}

// ========== تهيئة قاعدة البيانات ==========
function initializeDatabase() {
    try {
        db = new Database(dbPath);
        db.pragma('foreign_keys = ON');

        db.exec(`CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            tax_number TEXT,
            tax_rate REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            full_name TEXT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'cashier',
            is_blocked INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS permissions (
            user_id INTEGER PRIMARY KEY,
            can_edit_products INTEGER DEFAULT 0,
            can_edit_prices INTEGER DEFAULT 0,
            can_edit_users INTEGER DEFAULT 0,
            can_view_reports INTEGER DEFAULT 0,
            can_close_shift INTEGER DEFAULT 0,
            can_refund INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            category_id INTEGER,
            price REAL,
            cost REAL DEFAULT 0,
            barcode TEXT,
            recipe TEXT,
            image TEXT,
            unit TEXT DEFAULT 'قطعة',
            daily_forecast INTEGER DEFAULT 0,
            monthly_forecast INTEGER DEFAULT 0,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS raw_materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            unit TEXT,
            current_stock REAL DEFAULT 0,
            min_stock REAL DEFAULT 0,
            purchase_price REAL DEFAULT 0,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            status TEXT DEFAULT 'free',
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS waiters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            user_id INTEGER,
            opening_cash REAL,
            closing_cash REAL,
            expected_cash REAL,
            cash_difference REAL,
            date TEXT,
            status TEXT DEFAULT 'open',
            closed_at DATETIME,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            table_id INTEGER,
            waiter_id INTEGER,
            user_id INTEGER,
            total REAL,
            tax REAL DEFAULT 0,
            total_with_tax REAL,
            discount REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'cash',
            paid_amount REAL,
            change_amount REAL,
            date TEXT,
            time TEXT,
            shift_id INTEGER,
            status TEXT DEFAULT 'completed',
            order_type TEXT DEFAULT 'local',
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(table_id) REFERENCES tables(id),
            FOREIGN KEY(waiter_id) REFERENCES waiters(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(shift_id) REFERENCES shifts(id)
        )`);

        try {
            db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'local'");
        } catch (e) {}

        db.exec(`CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_id INTEGER,
            qty INTEGER,
            price REAL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS refunds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            user_id INTEGER,
            amount REAL,
            reason TEXT,
            date TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            material_id INTEGER,
            qty_change REAL,
            type TEXT,
            reference TEXT,
            date TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(material_id) REFERENCES raw_materials(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            month TEXT,
            category TEXT,
            description TEXT,
            amount REAL,
            type TEXT DEFAULT 'fixed',
            date TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            details TEXT,
            ip TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS settings (
            company_id INTEGER PRIMARY KEY,
            safe_mode INTEGER DEFAULT 0,
            currency TEXT DEFAULT 'SAR',
            pagination INTEGER DEFAULT 20,
            show_company_screen INTEGER DEFAULT 1,
            profit_margin_percent REAL DEFAULT 30,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )`);

        // ========== البيانات الافتراضية ==========
        const row = db.prepare("SELECT COUNT(*) as count FROM companies").get();
        if (row.count === 0) {
            const companyId = 1;
            db.prepare("INSERT INTO companies (id, name, phone, address, tax_rate) VALUES (?, ?, ?, ?, ?)")
                .run(companyId, 'مطعم تقنيات سوفت', '773579486', 'اليمن - صنعاء', 0);

            const hash = bcrypt.hashSync('77357233199477', 10);
            db.prepare("INSERT INTO users (id, company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
                .run(1, companyId, 'المدير العام', 'admin', hash, 'admin');
            db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,1,1,1,1,1,1)")
                .run(1);

            const hashAcc = bcrypt.hashSync('77357233199477', 10);
            const accResult = db.prepare("INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)")
                .run(companyId, 'المحاسب', 'accountant', hashAcc, 'accountant');
            const accId = accResult.lastInsertRowid;
            db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,0,0,0,1,1,0)")
                .run(accId);

            const hashCash = bcrypt.hashSync('77357233199477', 10);
            const cashResult = db.prepare("INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)")
                .run(companyId, 'الكاشير', 'cashier', hashCash, 'cashier');
            const cashId = cashResult.lastInsertRowid;
            db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,0,0,0,0,0,0)")
                .run(cashId);

            db.prepare("INSERT INTO settings (company_id) VALUES (?)").run(companyId);

            const categories = ['أكلات شعبية', 'غداء', 'المعصوب', 'مشروبات'];
            categories.forEach(cat => {
                db.prepare("INSERT INTO categories (company_id, name) VALUES (?,?)").run(companyId, cat);
            });
        }

        console.log('✅ قاعدة البيانات مهيأة بنجاح');
        return true;
    } catch (error) {
        console.error('❌ فشل تهيئة قاعدة البيانات:', error);
        return false;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // لتصحيح الأخطاء
}

app.whenReady().then(() => {
    const dirsReady = ensureDirectories();
    if (!dirsReady) {
        dialog.showErrorBox('خطأ', 'فشل إنشاء مجلدات التطبيق');
        app.quit();
        return;
    }
    const dbReady = initializeDatabase();
    if (!dbReady) {
        dialog.showErrorBox('خطأ فادح', 'فشل تهيئة قاعدة البيانات.\nتأكد من صلاحيات الكتابة في:\n' + dbDir);
        app.quit();
        return;
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (db) db.close();
        app.quit();
    }
});

// ========== دوال مساعدة ==========
function logAudit(userId, action, details) {
    try {
        db.prepare("INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)")
            .run(userId, action, details);
    } catch (error) {
        console.error('خطأ في تسجيل التدقيق:', error);
    }
}

function backupDatabase() {
    const backupFile = path.join(backupDir, `backup_${new Date().toISOString().slice(0,10)}.db`);
    try {
        fs.copyFileSync(dbPath, backupFile);
        const files = fs.readdirSync(backupDir).filter(f => f.startsWith('backup_'));
        if (files.length > 7) {
            const sorted = files.sort();
            for (let i = 0; i < sorted.length - 7; i++) {
                fs.unlinkSync(path.join(backupDir, sorted[i]));
            }
        }
        return { success: true, path: backupFile };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ========== قنوات IPC الأساسية ==========
ipcMain.handle('db-query', (event, sql, params) => {
    try {
        if (!db) throw new Error('قاعدة البيانات غير مهيأة');
        const stmt = db.prepare(sql);
        return stmt.all(params || []);
    } catch (err) {
        console.error('خطأ في db-query:', err);
        throw err;
    }
});

ipcMain.handle('db-run', (event, sql, params) => {
    try {
        if (!db) throw new Error('قاعدة البيانات غير مهيأة');
        const stmt = db.prepare(sql);
        const info = stmt.run(params || []);
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    } catch (err) {
        console.error('خطأ في db-run:', err);
        throw err;
    }
});

ipcMain.handle('db-get', (event, sql, params) => {
    try {
        if (!db) throw new Error('قاعدة البيانات غير مهيأة');
        const stmt = db.prepare(sql);
        return stmt.get(params || []);
    } catch (err) {
        console.error('خطأ في db-get:', err);
        throw err;
    }
});

// ========== مسار userData (جديد) ==========
ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
});

// ========== المستخدمين والصلاحيات ==========
ipcMain.handle('login', async (event, { username, password }) => {
    try {
        const user = db.prepare("SELECT * FROM users WHERE username=? AND is_blocked=0").get(username);
        if (!user) return { success: false, error: 'اسم المستخدم غير موجود' };
        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) return { success: false, error: 'كلمة المرور خاطئة' };
        const perms = db.prepare("SELECT * FROM permissions WHERE user_id=?").get(user.id) || {};
        logAudit(user.id, 'login', 'تسجيل دخول');
        return { success: true, user: { ...user, permissions: perms } };
    } catch (error) {
        console.error('خطأ في login:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('create-user', async (event, data) => {
    try {
        const { company_id, full_name, username, password, role, currentUserId } = data;
        const hash = bcrypt.hashSync(password, 10);
        const result = db.prepare("INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?,?,?,?,?)")
            .run(company_id, full_name, username, hash, role);
        const userId = result.lastInsertRowid;
        const perms = {
            admin: { can_edit_products: 1, can_edit_prices: 1, can_edit_users: 1, can_view_reports: 1, can_close_shift: 1, can_refund: 1 },
            accountant: { can_edit_products: 0, can_edit_prices: 0, can_edit_users: 0, can_view_reports: 1, can_close_shift: 1, can_refund: 0 },
            cashier: { can_edit_products: 0, can_edit_prices: 0, can_edit_users: 0, can_view_reports: 0, can_close_shift: 0, can_refund: 0 }
        };
        const p = perms[role] || perms.cashier;
        db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,?,?,?,?,?,?)")
            .run(userId, p.can_edit_products, p.can_edit_prices, p.can_edit_users, p.can_view_reports, p.can_close_shift, p.can_refund);
        logAudit(currentUserId, 'create_user', `إنشاء مستخدم: ${username}`);
        return { success: true, id: userId };
    } catch (error) {
        console.error('خطأ في create-user:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-user', async (event, data) => {
    try {
        const { id, full_name, username, password, role, currentUserId } = data;
        const currentUser = db.prepare("SELECT role FROM users WHERE id=?").get(currentUserId);
        if (!currentUser || (currentUser.role !== 'admin' && currentUserId !== id)) {
            return { success: false, error: 'ليس لديك صلاحية لتعديل هذا المستخدم' };
        }
        if (password && password.length > 0) {
            const hash = bcrypt.hashSync(password, 10);
            db.prepare("UPDATE users SET full_name=?, username=?, password_hash=?, role=? WHERE id=?")
                .run(full_name, username, hash, role, id);
        } else {
            db.prepare("UPDATE users SET full_name=?, username=?, role=? WHERE id=?")
                .run(full_name, username, role, id);
        }
        logAudit(currentUserId, 'update_user', `تحديث بيانات المستخدم: ${username}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في update-user:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-block', async (event, { userId, currentUserId }) => {
    try {
        const user = db.prepare("SELECT is_blocked FROM users WHERE id=?").get(userId);
        if (!user) return { success: false, error: 'المستخدم غير موجود' };
        db.prepare("UPDATE users SET is_blocked=? WHERE id=?").run(user.is_blocked ? 0 : 1, userId);
        logAudit(currentUserId, 'toggle_block', `تغيير حالة الحظر للمستخدم #${userId}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في toggle-block:', error);
        return { success: false, error: error.message };
    }
});

// ========== بيانات الشركة والضريبة ==========
ipcMain.handle('get-company', async () => {
    try {
        return db.prepare("SELECT * FROM companies LIMIT 1").get();
    } catch (error) {
        console.error('خطأ في get-company:', error);
        return null;
    }
});

ipcMain.handle('update-company', async (event, data) => {
    try {
        const { name, phone, address, tax_number, tax_rate, userId } = data;
        db.prepare("UPDATE companies SET name=?, phone=?, address=?, tax_number=?, tax_rate=? WHERE id=1")
            .run(name, phone, address, tax_number, tax_rate || 0);
        logAudit(userId, 'update_company', 'تعديل بيانات المطعم');
        return { success: true };
    } catch (error) {
        console.error('خطأ في update-company:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-tax-rate', async () => {
    try {
        const row = db.prepare("SELECT tax_rate FROM companies WHERE id=1").get();
        return row ? row.tax_rate : 0;
    } catch (error) {
        console.error('خطأ في get-tax-rate:', error);
        return 0;
    }
});

// ========== الإعدادات ==========
ipcMain.handle('get-settings', async (event, companyId) => {
    try {
        const row = db.prepare("SELECT * FROM settings WHERE company_id=?").get(companyId);
        return row || {};
    } catch (error) {
        console.error('خطأ في get-settings:', error);
        return {};
    }
});

ipcMain.handle('save-settings', async (event, { companyId, settings, userId }) => {
    try {
        db.prepare("UPDATE settings SET safe_mode=?, pagination=?, profit_margin_percent=? WHERE company_id=?")
            .run(settings.safe_mode || 0, settings.pagination || 20, settings.profit_margin_percent || 30, companyId);
        logAudit(userId, 'save_settings', 'تعديل الإعدادات');
        return { success: true };
    } catch (error) {
        console.error('خطأ في save-settings:', error);
        return { success: false, error: error.message };
    }
});

// ========== المنتجات والأقسام ==========
ipcMain.handle('save-product', async (event, data) => {
    try {
        const { id, company_id, name, price, cost, category_id, barcode, recipe, unit, image, userId } = data;
        if (id) {
            db.prepare("UPDATE products SET name=?, price=?, category_id=?, cost=?, barcode=?, recipe=?, unit=?, image=? WHERE id=? AND company_id=?")
                .run(name, price, category_id, cost || 0, barcode, recipe, unit, image, id, company_id);
            logAudit(userId, 'edit_product', `تعديل منتج: ${name}`);
            return { success: true, id };
        } else {
            const result = db.prepare("INSERT INTO products (company_id, name, price, category_id, cost, barcode, recipe, unit, image) VALUES (?,?,?,?,?,?,?,?,?)")
                .run(company_id, name, price, category_id, cost || 0, barcode, recipe, unit, image);
            logAudit(userId, 'add_product', `إضافة منتج: ${name}`);
            return { success: true, id: result.lastInsertRowid };
        }
    } catch (error) {
        console.error('خطأ في save-product:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-product', async (event, { id, company_id, userId }) => {
    try {
        db.prepare("DELETE FROM products WHERE id=? AND company_id=?").run(id, company_id);
        logAudit(userId, 'delete_product', `حذف منتج #${id}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-product:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-category', async (event, { company_id, name, userId }) => {
    try {
        const result = db.prepare("INSERT INTO categories (company_id, name) VALUES (?,?)").run(company_id, name);
        logAudit(userId, 'add_category', `إضافة قسم: ${name}`);
        return { success: true, id: result.lastInsertRowid };
    } catch (error) {
        console.error('خطأ في save-category:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-category', async (event, { id, userId }) => {
    try {
        db.prepare("DELETE FROM categories WHERE id=?").run(id);
        logAudit(userId, 'delete_category', `حذف قسم #${id}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-category:', error);
        return { success: false, error: error.message };
    }
});

// ========== المواد الخام ==========
ipcMain.handle('save-material', async (event, data) => {
    try {
        const { id, company_id, name, unit, min_stock, purchase_price } = data;
        if (id) {
            db.prepare("UPDATE raw_materials SET name=?, unit=?, min_stock=?, purchase_price=? WHERE id=? AND company_id=?")
                .run(name, unit, min_stock, purchase_price, id, company_id);
            return { success: true, id };
        } else {
            const result = db.prepare("INSERT INTO raw_materials (company_id, name, unit, min_stock, purchase_price) VALUES (?,?,?,?,?)")
                .run(company_id, name, unit, min_stock, purchase_price);
            return { success: true, id: result.lastInsertRowid };
        }
    } catch (error) {
        console.error('خطأ في save-material:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-material', async (event, { id, company_id }) => {
    try {
        db.prepare("DELETE FROM raw_materials WHERE id=? AND company_id=?").run(id, company_id);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-material:', error);
        return { success: false, error: error.message };
    }
});

// ========== المخزون ==========
ipcMain.handle('add-stock', async (event, { material_id, qty, userId }) => {
    try {
        db.prepare("UPDATE raw_materials SET current_stock = current_stock + ? WHERE id=?").run(qty, material_id);
        db.prepare("INSERT INTO inventory_transactions (company_id, material_id, qty_change, type, reference, date, user_id) VALUES (?,?,?,?,?,?,?)")
            .run(1, material_id, qty, 'supply', 'توريد يدوي', new Date().toISOString().slice(0,10), userId);
        logAudit(userId, 'add_stock', `توريد مادة #${material_id} بكمية ${qty}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في add-stock:', error);
        return { success: false, error: error.message };
    }
});

// ========== الطلبات ==========
ipcMain.handle('create-order', async (event, data) => {
    try {
        const { company_id, table_id, waiter_id, user_id, total, tax, total_with_tax, discount, payment_method, paid_amount, shift_id, items, order_type = 'local' } = data;
        const today = new Date().toISOString().slice(0,10);
        const time = new Date().toLocaleTimeString('ar-SA');
        const result = db.prepare(`INSERT INTO orders (company_id, table_id, waiter_id, user_id, total, tax, total_with_tax, discount, payment_method, paid_amount, date, time, shift_id, order_type)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(company_id, table_id, waiter_id, user_id, total, tax || 0, total_with_tax || total, discount || 0, payment_method, paid_amount, today, time, shift_id, order_type);
        const orderId = result.lastInsertRowid;
        for (let item of items) {
            db.prepare("INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?,?,?,?)")
                .run(orderId, item.id, item.qty, item.price);
            if (item.recipe) {
                try {
                    const recipe = JSON.parse(item.recipe);
                    for (let comp of recipe) {
                        db.prepare("UPDATE raw_materials SET current_stock = current_stock - ? WHERE id=? AND company_id=?")
                            .run(comp.qty * item.qty, comp.material_id, company_id);
                        db.prepare("INSERT INTO inventory_transactions (company_id, material_id, qty_change, type, reference, date, user_id) VALUES (?,?,?,?,?,?,?)")
                            .run(company_id, comp.material_id, -comp.qty * item.qty, 'consumption', `طلب #${orderId}`, today, user_id);
                    }
                } catch(e) {}
            }
        }
        if (table_id) {
            db.prepare("UPDATE tables SET status='occupied' WHERE id=?").run(table_id);
        }
        logAudit(user_id, 'create_order', `طلب #${orderId} بقيمة ${total} (${order_type})`);
        return { success: true, orderId };
    } catch (error) {
        console.error('خطأ في create-order:', error);
        return { success: false, error: error.message };
    }
});

// ========== إرجاع الطلبات ==========
ipcMain.handle('refund-order', async (event, { orderId, userId, reason }) => {
    try {
        const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
        if (!order) return { success: false, error: 'الطلب غير موجود' };
        if (order.status === 'refunded') return { success: false, error: 'الطلب مرتجع مسبقاً' };
        const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);
        for (let item of items) {
            const product = db.prepare("SELECT * FROM products WHERE id=?").get(item.product_id);
            if (product && product.recipe) {
                try {
                    const recipe = JSON.parse(product.recipe);
                    for (let comp of recipe) {
                        db.prepare("UPDATE raw_materials SET current_stock = current_stock + ? WHERE id=?")
                            .run(comp.qty * item.qty, comp.material_id);
                    }
                } catch(e) {}
            }
        }
        db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(orderId);
        db.prepare("INSERT INTO refunds (order_id, user_id, amount, reason, date) VALUES (?,?,?,?,?)")
            .run(orderId, userId, order.total, reason, new Date().toISOString());
        logAudit(userId, 'refund_order', `إرجاع طلب #${orderId}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في refund-order:', error);
        return { success: false, error: error.message };
    }
});

// ========== الورديات ==========
ipcMain.handle('open-shift', async (event, { company_id, user_id, opening_cash }) => {
    try {
        const today = new Date().toISOString().slice(0,10);
        const result = db.prepare("INSERT INTO shifts (company_id, user_id, opening_cash, date, status) VALUES (?,?,?,?,?)")
            .run(company_id, user_id, opening_cash, today, 'open');
        logAudit(user_id, 'open_shift', `فتح وردية #${result.lastInsertRowid}`);
        return { success: true, shiftId: result.lastInsertRowid };
    } catch (error) {
        console.error('خطأ في open-shift:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('close-shift', async (event, { shiftId, actual_cash, userId }) => {
    try {
        const shift = db.prepare("SELECT * FROM shifts WHERE id=?").get(shiftId);
        if (!shift) return { success: false, error: 'الوردية غير موجودة' };
        if (shift.status !== 'open') return { success: false, error: 'الوردية مغلقة' };
        const totalSales = db.prepare("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE shift_id=?").get(shiftId).total;
        const expected = shift.opening_cash + totalSales;
        const difference = actual_cash - expected;
        db.prepare("UPDATE shifts SET closing_cash=?, expected_cash=?, cash_difference=?, status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(actual_cash, expected, difference, shiftId);
        backupDatabase();
        logAudit(userId, 'close_shift', `إغلاق وردية #${shiftId}، الفارق: ${difference}`);
        return { success: true, expected, difference };
    } catch (error) {
        console.error('خطأ في close-shift:', error);
        return { success: false, error: error.message };
    }
});

// ========== المصروفات ==========
ipcMain.handle('add-expense', async (event, data) => {
    try {
        const { company_id, month, category, description, amount, type, user_id } = data;
        db.prepare("INSERT INTO expenses (company_id, month, category, description, amount, type, date, user_id) VALUES (?,?,?,?,?,?,?,?)")
            .run(company_id, month, category, description, amount, type, new Date().toISOString().slice(0,10), user_id);
        logAudit(user_id, 'add_expense', `إضافة مصروف: ${description} بقيمة ${amount}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في add-expense:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-expense', async (event, { id, userId }) => {
    try {
        db.prepare("DELETE FROM expenses WHERE id=?").run(id);
        logAudit(userId, 'delete_expense', `حذف مصروف #${id}`);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-expense:', error);
        return { success: false, error: error.message };
    }
});

// ========== التقارير ==========
ipcMain.handle('get-sales-report', async (event, { startDate, endDate, companyId }) => {
    try {
        return db.prepare(`SELECT date, COUNT(*) as count, SUM(total) as total, SUM(tax) as tax, SUM(total_with_tax) as total_with_tax,
                    payment_method, SUM(paid_amount) as paid
                    FROM orders WHERE company_id=? AND date BETWEEN ? AND ? AND status='completed'
                    GROUP BY date, payment_method ORDER BY date`)
            .all(companyId, startDate, endDate);
    } catch (error) {
        console.error('خطأ في get-sales-report:', error);
        return [];
    }
});

ipcMain.handle('get-profit-report', async (event, { startDate, endDate, companyId }) => {
    try {
        const orders = db.prepare(`SELECT o.id, o.total, oi.product_id, oi.qty, p.cost
                    FROM orders o
                    JOIN order_items oi ON o.id = oi.order_id
                    JOIN products p ON oi.product_id = p.id
                    WHERE o.company_id=? AND o.date BETWEEN ? AND ? AND o.status='completed'`)
            .all(companyId, startDate, endDate);
        let totalCost = 0;
        for (let row of orders) {
            totalCost += (row.cost || 0) * row.qty;
        }
        const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
        const profit = totalSales - totalCost;
        return { totalSales, totalCost, profit };
    } catch (error) {
        console.error('خطأ في get-profit-report:', error);
        return { totalSales: 0, totalCost: 0, profit: 0 };
    }
});

ipcMain.handle('get-expense-report', async (event, { startDate, endDate, companyId }) => {
    try {
        return db.prepare("SELECT category, SUM(amount) as total FROM expenses WHERE company_id=? AND date BETWEEN ? AND ? GROUP BY category")
            .all(companyId, startDate, endDate);
    } catch (error) {
        console.error('خطأ في get-expense-report:', error);
        return [];
    }
});

// ========== الطباعة ==========
ipcMain.handle('print-thermal', async (event, { html, userId }) => {
    try {
        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: 'USB',
            options: { timeout: 5000 }
        });
        await printer.connect();
        await printer.print(html);
        await printer.disconnect();
        logAudit(userId, 'print_receipt', 'طباعة فاتورة حرارية');
        return { success: true, method: 'thermal' };
    } catch (e) {
        console.warn('فشلت الطباعة الحرارية، استخدام نافذة المتصفح:', e.message);
        if (mainWindow) {
            mainWindow.webContents.send('fallback-print', html);
        }
        return { success: true, method: 'fallback' };
    }
});

// ========== الصور ==========
ipcMain.handle('save-product-image', async (event, { fileName, buffer }) => {
    try {
        const filePath = path.join(imagesDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, imagePath: `product-images/${fileName}` };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ========== نسخ احتياطي ==========
ipcMain.handle('manual-backup', async () => {
    return backupDatabase();
});

// ========== الطاولات والكباتن ==========
ipcMain.handle('save-table', async (event, { company_id, name }) => {
    try {
        db.prepare("INSERT INTO tables (company_id, name) VALUES (?,?)").run(company_id, name);
        return { success: true };
    } catch (error) {
        console.error('خطأ في save-table:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-table', async (event, { id }) => {
    try {
        db.prepare("DELETE FROM tables WHERE id=?").run(id);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-table:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-waiter', async (event, { company_id, name }) => {
    try {
        db.prepare("INSERT INTO waiters (company_id, name) VALUES (?,?)").run(company_id, name);
        return { success: true };
    } catch (error) {
        console.error('خطأ في save-waiter:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-waiter', async (event, { id }) => {
    try {
        db.prepare("DELETE FROM waiters WHERE id=?").run(id);
        return { success: true };
    } catch (error) {
        console.error('خطأ في delete-waiter:', error);
        return { success: false, error: error.message };
    }
});

// ========== تصدير PDF ==========
ipcMain.handle('export-pdf', async (event, { content, title, userId }) => {
    try {
        // التحقق من وجود الخطوط
        const hasTajawal = fs.existsSync(path.join(__dirname, 'assets/fonts/Tajawal-Regular.ttf'));
        const fontToUse = hasTajawal ? 'Tajawal' : 'Roboto';

        const docDefinition = {
            content: content,
            defaultStyle: {
                font: fontToUse,
                fontSize: 12,
                alignment: 'right'
            },
            pageDirection: 'RTL'
        };

        const pdfDoc = pdfMake.createPdfKitDocument(docDefinition);
        const filePath = path.join(app.getPath('documents'), `${title}_${Date.now()}.pdf`);

        return new Promise((resolve) => {
            const chunks = [];
            pdfDoc.on('data', chunk => chunks.push(chunk));
            pdfDoc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                fs.writeFile(filePath, buffer, (err) => {
                    if (err) resolve({ success: false, error: err.message });
                    else {
                        logAudit(userId, 'export_pdf', `تصدير تقرير: ${title}`);
                        resolve({ success: true, path: filePath });
                    }
                });
            });
            pdfDoc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
            pdfDoc.end();
        });
    } catch (e) {
        console.error('خطأ في تصدير PDF:', e);
        return { success: false, error: e.message };
    }
});

// ========== سجل التدقيق ==========
ipcMain.handle('get-audit-log', async (event, { limit = 100 }) => {
    try {
        return db.prepare("SELECT * FROM audit_log ORDER BY date DESC LIMIT ?").all(limit);
    } catch (error) {
        console.error('خطأ في get-audit-log:', error);
        return [];
    }
});

console.log('✅ نظام تقنيات سوفت المطور جاهز');