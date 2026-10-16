import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'omnia.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma('foreign_keys = ON');
const migration = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
db.exec(migration);

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const roles = { admin: 4, manager: 3, technician: 2, viewer: 1 };
const planLimits = {
  free: { equipment: 10, workOrders: 30, users: 2 },
  essential: { equipment: 100, workOrders: 500, users: 5 },
  professional: { equipment: 1000, workOrders: 10000, users: 25 }
};

function id() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function dateOnly(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null; }
function jsonError(res, status, message, details) { return res.status(status).json({ error: message, ...(details ? { details } : {}) }); }
function safeUser(user) { return { id: user.id, companyId: user.company_id, name: user.name, email: user.email, role: user.role }; }
function cookieOptions(maxAge) { return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function seed() {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return;
  const companyId = id();
  const userId = id();
  const passwordHash = bcrypt.hashSync('omnia123!', 10);
  const insertCompany = db.prepare('INSERT INTO companies (id, name, plan, plan_status) VALUES (?, ?, ?, ?)');
  const insertUser = db.prepare('INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)');
  const insertEquipment = db.prepare('INSERT INTO equipment (id, company_id, code, description, manufacturer, model, serial_number, location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertOrder = db.prepare('INSERT INTO work_orders (id, company_id, equipment_id, number, description, priority, responsible, status, scheduled_for, labor_cost, material_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertMaterial = db.prepare('INSERT INTO materials (id, company_id, sku, name, unit, current_stock, minimum_stock, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertPlan = db.prepare('INSERT INTO preventive_plans (id, company_id, equipment_id, title, task, frequency_days, next_due) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    insertCompany.run(companyId, 'Oficina Modelo OMNIA', 'free', 'trial');
    insertUser.run(userId, companyId, 'Administrador Demo', 'admin@omnia.local', passwordHash, 'admin');
    const pumpId = id();
    insertEquipment.run(pumpId, companyId, 'EQ-001', 'Bomba hidráulica principal', 'WEG', 'BHP-200', 'SN-2026-001', 'Galpão A', 'operacional');
    insertEquipment.run(id(), companyId, 'EQ-002', 'Compressor de ar', 'Schulz', 'CSV 20', 'SN-2026-002', 'Oficina', 'atenção');
    insertOrder.run(id(), companyId, pumpId, 'OS-0001', 'Troca do selo mecânico e inspeção de vibração', 'alta', 'Marina Técnico', 'em andamento', new Date(Date.now() + 86400000).toISOString().slice(0, 10), 180, 60, 'Acompanhar ruído após o reparo.');
    insertOrder.run(id(), companyId, pumpId, 'OS-0002', 'Limpeza e reaperto do painel', 'normal', 'João Operador', 'concluída', new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), 90, 0, 'Serviço concluído sem pendências.');
    insertMaterial.run(id(), companyId, 'MAT-001', 'Selo mecânico 25 mm', 'un', 3, 2, 42.5);
    insertMaterial.run(id(), companyId, 'MAT-002', 'Óleo lubrificante ISO 68', 'L', 8, 10, 29.9);
    insertPlan.run(id(), companyId, pumpId, 'Inspeção mensal da bomba', 'Verificar vibração, ruído, vazamentos e reaperto.', 30, new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10));
  })();
}
seed();

function auth(req, res, next) {
  const raw = req.headers.cookie?.match(/omnia_session=([^;]+)/)?.[1];
  if (!raw) return jsonError(res, 401, 'É necessário entrar para continuar.');
  const session = db.prepare(`SELECT s.*, u.company_id, u.name, u.email, u.role, u.active, c.name AS company_name, c.plan, c.plan_status
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(raw), nowIso());
  if (!session || !session.active) return jsonError(res, 401, 'Sessão expirada. Entre novamente.');
  req.user = session;
  next();
}
function requireRole(minRole) {
  return (req, res, next) => roles[req.user.role] >= roles[minRole] ? next() : jsonError(res, 403, 'Seu perfil não possui permissão para esta ação.');
}
function limitCheck(req, table, limitKey) {
  const limit = planLimits[req.user.plan]?.[limitKey];
  if (!limit) return true;
  const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE company_id = ?`).get(req.user.company_id).count;
  return count < limit;
}
function companyRecord(table, resourceId, companyId) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(resourceId, companyId);
}
function normalizeOrder(row) { return row ? { ...row, total_cost: Number(row.labor_cost || 0) + Number(row.material_cost || 0) } : row; }

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'omnia-pcm-lite', time: nowIso() }));
app.post('/api/auth/register', (req, res) => {
  const companyName = clean(req.body.companyName, 120), name = clean(req.body.name, 100), email = clean(req.body.email, 180).toLowerCase(), password = String(req.body.password || '');
  if (companyName.length < 2 || name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return jsonError(res, 400, 'Informe empresa, nome, e-mail válido e senha com pelo menos 8 caracteres.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return jsonError(res, 409, 'Este e-mail já está cadastrado.');
  const companyId = id(), userId = id();
  db.transaction(() => {
    db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(companyId, companyName);
    db.prepare('INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)').run(userId, companyId, name, email, bcrypt.hashSync(password, 12), 'admin');
  })();
  return createSession(res, { id: userId, company_id: companyId, name, email, role: 'admin' });
});
function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = Number(process.env.SESSION_DAYS || 7);
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(id(), user.id, tokenHash(token), new Date(Date.now() + days * 86400000).toISOString());
  res.setHeader('Set-Cookie', `omnia_session=${token}; ${cookieOptions(days * 86400000)}`);
  return res.status(201).json({ user: safeUser(user) });
}
app.post('/api/auth/login', (req, res) => {
  const email = clean(req.body.email, 180).toLowerCase(), password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) return jsonError(res, 401, 'E-mail ou senha inválidos.');
  return createSession(res, user);
});
app.post('/api/auth/logout', auth, (req, res) => {
  const raw = req.headers.cookie.match(/omnia_session=([^;]+)/)?.[1];
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(raw));
  res.setHeader('Set-Cookie', `omnia_session=; ${cookieOptions(0)}`);
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ user: safeUser(req.user), company: { id: req.user.company_id, name: req.user.company_name, plan: req.user.plan, planStatus: req.user.plan_status, limits: planLimits[req.user.plan] } }));

app.get('/api/dashboard', auth, (req, res) => {
  const company = req.user.company_id;
  const stats = {
    equipment: db.prepare('SELECT COUNT(*) AS count FROM equipment WHERE company_id = ?').get(company).count,
    openOrders: db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE company_id = ? AND status IN ('aberta','em andamento')").get(company).count,
    overdueOrders: db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE company_id = ? AND status IN ('aberta','em andamento') AND scheduled_for < date('now')").get(company).count,
    completedOrders: db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE company_id = ? AND status = 'concluída'").get(company).count,
    monthCost: db.prepare("SELECT COALESCE(SUM(labor_cost + material_cost),0) AS total FROM work_orders WHERE company_id = ? AND created_at >= date('now','-30 day')").get(company).total,
    lowStock: db.prepare('SELECT COUNT(*) AS count FROM materials WHERE company_id = ? AND current_stock <= minimum_stock').get(company).count
  };
  const upcoming = db.prepare(`SELECT p.*, e.code AS equipment_code, e.description AS equipment_description FROM preventive_plans p LEFT JOIN equipment e ON e.id = p.equipment_id WHERE p.company_id = ? AND p.active = 1 ORDER BY p.next_due LIMIT 5`).all(company);
  const recent = db.prepare(`SELECT w.*, e.code AS equipment_code FROM work_orders w LEFT JOIN equipment e ON e.id = w.equipment_id WHERE w.company_id = ? ORDER BY w.created_at DESC LIMIT 6`).all(company).map(normalizeOrder);
  res.json({ stats, upcoming, recent });
});

app.get('/api/equipment', auth, (req, res) => res.json({ data: db.prepare('SELECT * FROM equipment WHERE company_id = ? ORDER BY code').all(req.user.company_id) }));
app.post('/api/equipment', auth, requireRole('technician'), (req, res) => {
  if (!limitCheck(req, 'equipment', 'equipment')) return jsonError(res, 409, 'O limite do plano atual para equipamentos foi atingido.');
  const data = { code: clean(req.body.code, 40), description: clean(req.body.description, 160), manufacturer: clean(req.body.manufacturer, 100), model: clean(req.body.model, 100), serial_number: clean(req.body.serialNumber, 100), location: clean(req.body.location, 120), status: clean(req.body.status, 20) || 'operacional' };
  if (!data.code || !data.description || !['operacional','atenção','parado','desativado'].includes(data.status)) return jsonError(res, 400, 'Código, descrição e situação válida são obrigatórios.');
  try { const row = { id: id(), company_id: req.user.company_id, ...data }; db.prepare('INSERT INTO equipment (id, company_id, code, description, manufacturer, model, serial_number, location, status) VALUES (@id, @company_id, @code, @description, @manufacturer, @model, @serial_number, @location, @status)').run(row); res.status(201).json({ data: row }); } catch { jsonError(res, 409, 'O código do equipamento já existe nesta empresa.'); }
});
app.patch('/api/equipment/:id', auth, requireRole('technician'), (req, res) => {
  const existing = companyRecord('equipment', req.params.id, req.user.company_id); if (!existing) return jsonError(res, 404, 'Equipamento não encontrado.');
  const next = { ...existing, code: clean(req.body.code ?? existing.code, 40), description: clean(req.body.description ?? existing.description, 160), manufacturer: clean(req.body.manufacturer ?? existing.manufacturer, 100), model: clean(req.body.model ?? existing.model, 100), serial_number: clean(req.body.serialNumber ?? existing.serial_number, 100), location: clean(req.body.location ?? existing.location, 120), status: clean(req.body.status ?? existing.status, 20) };
  db.prepare('UPDATE equipment SET code=@code, description=@description, manufacturer=@manufacturer, model=@model, serial_number=@serial_number, location=@location, status=@status WHERE id=@id AND company_id=@company_id').run(next); res.json({ data: next });
});

app.get('/api/work-orders', auth, (req, res) => res.json({ data: db.prepare(`SELECT w.*, e.code AS equipment_code, e.description AS equipment_description FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id = ? ORDER BY CASE w.status WHEN 'aberta' THEN 1 WHEN 'em andamento' THEN 2 ELSE 3 END, w.created_at DESC`).all(req.user.company_id).map(normalizeOrder) }));
app.post('/api/work-orders', auth, requireRole('technician'), (req, res) => {
  if (!limitCheck(req, 'work_orders', 'workOrders')) return jsonError(res, 409, 'O limite de ordens do plano atual foi atingido.');
  const data = { id: id(), company_id: req.user.company_id, equipment_id: clean(req.body.equipmentId, 40) || null, number: `OS-${String(db.prepare('SELECT COUNT(*) AS count FROM work_orders WHERE company_id=?').get(req.user.company_id).count + 1).padStart(4, '0')}`, description: clean(req.body.description, 500), priority: clean(req.body.priority, 20) || 'normal', responsible: clean(req.body.responsible, 120), status: 'aberta', scheduled_for: dateOnly(req.body.scheduledFor), labor_cost: Math.max(0, number(req.body.laborCost)), material_cost: Math.max(0, number(req.body.materialCost)), notes: clean(req.body.notes, 1000) };
  if (!data.description || !['baixa','normal','alta','crítica'].includes(data.priority)) return jsonError(res, 400, 'Descrição e prioridade válida são obrigatórias.');
  if (data.equipment_id && !companyRecord('equipment', data.equipment_id, req.user.company_id)) return jsonError(res, 400, 'Equipamento inválido para esta empresa.');
  db.prepare('INSERT INTO work_orders (id, company_id, equipment_id, number, description, priority, responsible, status, scheduled_for, labor_cost, material_cost, notes) VALUES (@id,@company_id,@equipment_id,@number,@description,@priority,@responsible,@status,@scheduled_for,@labor_cost,@material_cost,@notes)').run(data); res.status(201).json({ data: normalizeOrder(data) });
});
app.patch('/api/work-orders/:id', auth, requireRole('technician'), (req, res) => {
  const existing = companyRecord('work_orders', req.params.id, req.user.company_id); if (!existing) return jsonError(res, 404, 'Ordem de serviço não encontrada.');
  const status = clean(req.body.status ?? existing.status, 20); if (!['aberta','em andamento','concluída','cancelada'].includes(status)) return jsonError(res, 400, 'Status inválido.');
  const next = { ...existing, description: clean(req.body.description ?? existing.description, 500), priority: clean(req.body.priority ?? existing.priority, 20), responsible: clean(req.body.responsible ?? existing.responsible, 120), status, scheduled_for: dateOnly(req.body.scheduledFor ?? existing.scheduled_for), executed_at: status === 'concluída' ? (existing.executed_at || nowIso()) : existing.executed_at, closed_at: status === 'concluída' ? nowIso() : existing.closed_at, labor_cost: Math.max(0, number(req.body.laborCost ?? existing.labor_cost)), material_cost: Math.max(0, number(req.body.materialCost ?? existing.material_cost)), notes: clean(req.body.notes ?? existing.notes, 1000) };
  db.prepare('UPDATE work_orders SET description=@description, priority=@priority, responsible=@responsible, status=@status, scheduled_for=@scheduled_for, executed_at=@executed_at, closed_at=@closed_at, labor_cost=@labor_cost, material_cost=@material_cost, notes=@notes WHERE id=@id AND company_id=@company_id').run(next); res.json({ data: normalizeOrder(next) });
});

app.get('/api/preventive', auth, (req, res) => res.json({ data: db.prepare('SELECT p.*, e.code AS equipment_code, e.description AS equipment_description FROM preventive_plans p LEFT JOIN equipment e ON e.id=p.equipment_id WHERE p.company_id=? ORDER BY p.next_due').all(req.user.company_id) }));
app.post('/api/preventive', auth, requireRole('technician'), (req, res) => {
  const row = { id: id(), company_id: req.user.company_id, equipment_id: clean(req.body.equipmentId, 40) || null, title: clean(req.body.title, 140), task: clean(req.body.task, 500), frequency_days: Math.max(1, Math.round(number(req.body.frequencyDays, 30))), next_due: dateOnly(req.body.nextDue) };
  if (!row.title || !row.task || !row.next_due) return jsonError(res, 400, 'Título, tarefa e próxima data são obrigatórios.');
  if (row.equipment_id && !companyRecord('equipment', row.equipment_id, req.user.company_id)) return jsonError(res, 400, 'Equipamento inválido para esta empresa.');
  db.prepare('INSERT INTO preventive_plans (id,company_id,equipment_id,title,task,frequency_days,next_due) VALUES (@id,@company_id,@equipment_id,@title,@task,@frequency_days,@next_due)').run(row); res.status(201).json({ data: row });
});

app.get('/api/materials', auth, (req, res) => res.json({ data: db.prepare('SELECT *, current_stock <= minimum_stock AS low_stock FROM materials WHERE company_id=? ORDER BY name').all(req.user.company_id) }));
app.post('/api/materials', auth, requireRole('technician'), (req, res) => {
  const row = { id: id(), company_id: req.user.company_id, sku: clean(req.body.sku, 40), name: clean(req.body.name, 160), unit: clean(req.body.unit, 20) || 'un', current_stock: Math.max(0, number(req.body.currentStock)), minimum_stock: Math.max(0, number(req.body.minimumStock)), unit_cost: Math.max(0, number(req.body.unitCost)) };
  if (!row.sku || !row.name) return jsonError(res, 400, 'SKU e nome são obrigatórios.');
  try { db.prepare('INSERT INTO materials (id,company_id,sku,name,unit,current_stock,minimum_stock,unit_cost) VALUES (@id,@company_id,@sku,@name,@unit,@current_stock,@minimum_stock,@unit_cost)').run(row); res.status(201).json({ data: row }); } catch { jsonError(res, 409, 'O SKU já existe nesta empresa.'); }
});
app.post('/api/materials/:id/movements', auth, requireRole('technician'), (req, res) => {
  const material = companyRecord('materials', req.params.id, req.user.company_id); if (!material) return jsonError(res, 404, 'Material não encontrado.');
  const type = clean(req.body.type, 10), quantity = number(req.body.quantity); if (!['entrada','saída'].includes(type) || quantity <= 0) return jsonError(res, 400, 'Tipo e quantidade válidos são obrigatórios.');
  if (type === 'saída' && material.current_stock < quantity) return jsonError(res, 409, 'Saldo insuficiente para esta saída.');
  const nextStock = material.current_stock + (type === 'entrada' ? quantity : -quantity);
  db.transaction(() => { db.prepare('UPDATE materials SET current_stock=? WHERE id=? AND company_id=?').run(nextStock, material.id, req.user.company_id); db.prepare('INSERT INTO stock_movements (id,company_id,material_id,type,quantity,reason) VALUES (?,?,?,?,?,?)').run(id(), req.user.company_id, material.id, type, quantity, clean(req.body.reason, 240)); })();
  res.status(201).json({ data: { ...material, current_stock: nextStock } });
});

app.get('/api/reports/summary', auth, (req, res) => {
  const c = req.user.company_id;
  const rows = db.prepare(`SELECT w.number, w.description, w.status, w.priority, w.opened_at, w.closed_at, e.code AS equipment_code, w.labor_cost, w.material_cost, (w.labor_cost+w.material_cost) AS total_cost FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY w.created_at DESC`).all(c);
  res.json({ data: rows, totals: { orders: rows.length, cost: rows.reduce((sum, r) => sum + Number(r.total_cost || 0), 0) } });
});
app.get('/api/reports/export.csv', auth, (req, res) => {
  const rows = db.prepare(`SELECT w.number, w.description, w.status, w.priority, e.code AS equipment_code, w.labor_cost, w.material_cost, (w.labor_cost+w.material_cost) AS total_cost FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY w.created_at DESC`).all(req.user.company_id);
  const csv = ['Número;Descrição;Status;Prioridade;Equipamento;Mão de obra;Materiais;Total', ...rows.map(r => [r.number, r.description, r.status, r.priority, r.equipment_code || '', r.labor_cost, r.material_cost, r.total_cost].map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="omnia-relatorio-os.csv"'); res.send('\ufeff' + csv);
});

app.post('/api/payments/checkout', auth, (req, res) => {
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ status: 'manual_setup_required', message: 'Checkout ainda não configurado: é necessário cadastrar uma aplicação e as credenciais do Mercado Pago.' });
  return res.status(501).json({ status: 'not_implemented', message: 'A integração automática exige configurar a aplicação, URLs públicas e webhooks antes de liberar vendas.' });
});
app.post('/api/payments/webhook', (req, res) => {
  if (!process.env.MP_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook não configurado.' });
  res.status(202).json({ received: true, processed: false, message: 'Endpoint reservado para validação HMAC e consulta do status oficial do pagamento.' });
});

app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Erro interno. Consulte os logs do serviço.' }); });

if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`OMNIA PCM Lite em http://localhost:${port}`));
export { app, db };
