import bcrypt from 'bcryptjs';

const roles = { admin: 4, manager: 3, technician: 2, viewer: 1 };
const planLimits = {
  free: { equipment: 10, workOrders: 30, users: 2 },
  essential: { equipment: 100, workOrders: 500, users: 5 },
  professional: { equipment: 1000, workOrders: 10000, users: 25 }
};
const planProducts = {
  essential: { title: 'OMNIA PCM Lite Essencial', amount: 49.90 },
  professional: { title: 'OMNIA PCM Lite Profissional', amount: 99.90 }
};

const id = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const error = (status, message, details) => json({ error: message, ...(details ? { details } : {}) }, status);
const safeUser = (user) => ({ id: user.id, companyId: user.company_id, name: user.name, email: user.email, role: user.role });
const normalizeOrder = (row) => row ? { ...row, total_cost: Number(row.labor_cost || 0) + Number(row.material_cost || 0) } : row;
const bind = (env, sql, ...params) => env.DB.prepare(sql).bind(...params);
const first = async (env, sql, ...params) => (await bind(env, sql, ...params).first()) || null;
const all = async (env, sql, ...params) => (await bind(env, sql, ...params).all()).results || [];
const run = async (env, sql, ...params) => bind(env, sql, ...params).run();
const batch = async (env, statements) => env.DB.batch(statements);

function responseWithCookie(data, token, maxAge, status = 201) {
  return json(data, status, { 'set-cookie': `omnia_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}; Secure` });
}
function clearCookie(data) { return json(data, 200, { 'set-cookie': 'omnia_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure' }); }
async function digestHex(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function tokenHash(token) { return digestHex(token); }
function randomToken() { return `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`; }
async function body(req) { return req.json().catch(() => ({})); }
function cookie(req) { return req.headers.get('cookie')?.match(/(?:^|;\s*)omnia_session=([^;]+)/)?.[1] || ''; }
function cookieMaxAge(env) { return Number(env.SESSION_DAYS || 7) * 86400000; }

async function seed(env) {
  if (env.DEMO_MODE !== 'true') return;
  const count = await first(env, 'SELECT COUNT(*) AS count FROM users');
  if (Number(count?.count || 0) > 0) return;
  const companyId = id(), userId = id(), pumpId = id();
  const passwordHash = bcrypt.hashSync('omnia123!', 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
  const next = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  await batch(env, [
    bind(env, 'INSERT INTO companies (id,name,plan,plan_status) VALUES (?,?,?,?)', companyId, 'Oficina Modelo OMNIA', 'free', 'trial'),
    bind(env, 'INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)', userId, companyId, 'Administrador Demo', 'admin@omnia.local', passwordHash, 'admin'),
    bind(env, 'INSERT INTO equipment (id,company_id,code,description,manufacturer,model,serial_number,location,status) VALUES (?,?,?,?,?,?,?,?,?)', pumpId, companyId, 'EQ-001', 'Bomba hidráulica principal', 'WEG', 'BHP-200', 'SN-2026-001', 'Galpão A', 'operacional'),
    bind(env, 'INSERT INTO equipment (id,company_id,code,description,manufacturer,model,serial_number,location,status) VALUES (?,?,?,?,?,?,?,?,?)', id(), companyId, 'EQ-002', 'Compressor de ar', 'Schulz', 'CSV 20', 'SN-2026-002', 'Oficina', 'atenção'),
    bind(env, 'INSERT INTO work_orders (id,company_id,equipment_id,number,description,priority,responsible,status,scheduled_for,labor_cost,material_cost,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id(), companyId, pumpId, 'OS-0001', 'Troca do selo mecânico e inspeção de vibração', 'alta', 'Marina Técnico', 'em andamento', tomorrow, 180, 60, 'Acompanhar ruído após o reparo.'),
    bind(env, 'INSERT INTO work_orders (id,company_id,equipment_id,number,description,priority,responsible,status,scheduled_for,labor_cost,material_cost,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id(), companyId, pumpId, 'OS-0002', 'Limpeza e reaperto do painel', 'normal', 'João Operador', 'concluída', past, 90, 0, 'Serviço concluído sem pendências.'),
    bind(env, 'INSERT INTO materials (id,company_id,sku,name,unit,current_stock,minimum_stock,unit_cost) VALUES (?,?,?,?,?,?,?,?)', id(), companyId, 'MAT-001', 'Selo mecânico 25 mm', 'un', 3, 2, 42.5),
    bind(env, 'INSERT INTO materials (id,company_id,sku,name,unit,current_stock,minimum_stock,unit_cost) VALUES (?,?,?,?,?,?,?,?)', id(), companyId, 'MAT-002', 'Óleo lubrificante ISO 68', 'L', 8, 10, 29.9),
    bind(env, 'INSERT INTO preventive_plans (id,company_id,equipment_id,title,task,frequency_days,next_due) VALUES (?,?,?,?,?,?,?)', id(), companyId, pumpId, 'Inspeção mensal da bomba', 'Verificar vibração, ruído, vazamentos e reaperto.', 30, next)
  ]);
}

async function createSession(env, user) {
  const token = randomToken();
  await run(env, 'INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)', id(), user.id, await tokenHash(token), new Date(Date.now() + cookieMaxAge(env)).toISOString());
  return responseWithCookie({ user: safeUser(user) }, token, cookieMaxAge(env));
}
async function auth(req, env) {
  const raw = cookie(req);
  if (!raw) return { response: error(401, 'É necessário entrar para continuar.') };
  const session = await first(env, `SELECT s.*, u.company_id, u.name, u.email, u.role, u.active, c.name AS company_name, c.plan, c.plan_status
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN companies c ON c.id=u.company_id
    WHERE s.token_hash=? AND s.expires_at>?`, await tokenHash(raw), nowIso());
  if (!session || !session.active) return { response: error(401, 'Sessão expirada. Entre novamente.') };
  return { user: session };
}
function roleAllowed(user, role) { return roles[user.role] >= roles[role]; }
async function companyRecord(env, table, resourceId, companyId) { return first(env, `SELECT * FROM ${table} WHERE id=? AND company_id=?`, resourceId, companyId); }
async function limitCheck(env, user, table, key) {
  const limit = planLimits[user.plan]?.[key];
  if (!limit) return true;
  const row = await first(env, `SELECT COUNT(*) AS count FROM ${table} WHERE company_id=?`, user.company_id);
  return Number(row?.count || 0) < limit;
}
async function me(req, env) {
  const session = await auth(req, env);
  if (session.response) return session.response;
  return json({ user: safeUser(session.user), company: { id: session.user.company_id, name: session.user.company_name, plan: session.user.plan, planStatus: session.user.plan_status, limits: planLimits[session.user.plan] } });
}
async function jsonBody(req) { return body(req); }

async function api(req, env, url) {
  const method = req.method;
  if (method === 'GET' && url.pathname === '/api/health') return json({ ok: true, service: 'omnia-pcm-lite-cloudflare', time: nowIso() });
  if (method === 'POST' && url.pathname === '/api/auth/register') {
    const input = await jsonBody(req);
    const companyName = clean(input.companyName, 120), name = clean(input.name, 100), email = clean(input.email, 180).toLowerCase(), password = String(input.password || '');
    if (companyName.length < 2 || name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return error(400, 'Informe empresa, nome, e-mail válido e senha com pelo menos 8 caracteres.');
    if (await first(env, 'SELECT id FROM users WHERE email=?', email)) return error(409, 'Este e-mail já está cadastrado.');
    const companyId = id(), userId = id();
    await batch(env, [bind(env, 'INSERT INTO companies (id,name) VALUES (?,?)', companyId, companyName), bind(env, 'INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)', userId, companyId, name, email, bcrypt.hashSync(password, 12), 'admin')]);
    return createSession(env, { id: userId, company_id: companyId, name, email, role: 'admin' });
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const input = await jsonBody(req), email = clean(input.email, 180).toLowerCase(), password = String(input.password || '');
    const user = await first(env, 'SELECT * FROM users WHERE email=?', email);
    if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) return error(401, 'E-mail ou senha inválidos.');
    return createSession(env, user);
  }
  if (method === 'POST' && url.pathname === '/api/payments/webhook') return webhook(req, env, url);
  if (method === 'GET' && url.pathname === '/api/me') return me(req, env);
  const session = await auth(req, env);
  if (session.response) return session.response;
  const user = session.user;
  if (method === 'POST' && url.pathname === '/api/auth/logout') { await run(env, 'DELETE FROM sessions WHERE token_hash=?', await tokenHash(cookie(req))); return clearCookie({ ok: true }); }
  if (method === 'GET' && url.pathname === '/api/dashboard') {
    const c = user.company_id;
    const [equipment, openOrders, overdueOrders, completedOrders, monthCost, lowStock, upcoming, recent] = await Promise.all([
      first(env, 'SELECT COUNT(*) AS count FROM equipment WHERE company_id=?', c), first(env, "SELECT COUNT(*) AS count FROM work_orders WHERE company_id=? AND status IN ('aberta','em andamento')", c), first(env, "SELECT COUNT(*) AS count FROM work_orders WHERE company_id=? AND status IN ('aberta','em andamento') AND scheduled_for < date('now')", c), first(env, "SELECT COUNT(*) AS count FROM work_orders WHERE company_id=? AND status='concluída'", c), first(env, "SELECT COALESCE(SUM(labor_cost+material_cost),0) AS total FROM work_orders WHERE company_id=? AND created_at >= date('now','-30 day')", c), first(env, 'SELECT COUNT(*) AS count FROM materials WHERE company_id=? AND current_stock <= minimum_stock', c), all(env, 'SELECT p.*,e.code AS equipment_code,e.description AS equipment_description FROM preventive_plans p LEFT JOIN equipment e ON e.id=p.equipment_id WHERE p.company_id=? AND p.active=1 ORDER BY p.next_due LIMIT 5', c), all(env, 'SELECT w.*,e.code AS equipment_code FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY w.created_at DESC LIMIT 6', c)
    ]);
    return json({ stats: { equipment: Number(equipment.count), openOrders: Number(openOrders.count), overdueOrders: Number(overdueOrders.count), completedOrders: Number(completedOrders.count), monthCost: monthCost.total, lowStock: Number(lowStock.count) }, upcoming, recent: recent.map(normalizeOrder) });
  }
  if (method === 'GET' && url.pathname === '/api/equipment') return json({ data: await all(env, 'SELECT * FROM equipment WHERE company_id=? ORDER BY code', user.company_id) });
  if (method === 'POST' && url.pathname === '/api/equipment') {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    if (!await limitCheck(env, user, 'equipment', 'equipment')) return error(409, 'O limite do plano atual para equipamentos foi atingido.');
    const input = await jsonBody(req), row = { id: id(), company_id: user.company_id, code: clean(input.code, 40), description: clean(input.description, 160), manufacturer: clean(input.manufacturer, 100), model: clean(input.model, 100), serial_number: clean(input.serialNumber, 100), location: clean(input.location, 120), status: clean(input.status, 20) || 'operacional' };
    if (!row.code || !row.description || !['operacional','atenção','parado','desativado'].includes(row.status)) return error(400, 'Código, descrição e situação válida são obrigatórios.');
    try { await run(env, 'INSERT INTO equipment (id,company_id,code,description,manufacturer,model,serial_number,location,status) VALUES (?,?,?,?,?,?,?,?,?)', row.id,row.company_id,row.code,row.description,row.manufacturer,row.model,row.serial_number,row.location,row.status); return json({ data: row }, 201); } catch { return error(409, 'O código do equipamento já existe nesta empresa.'); }
  }
  if (method === 'GET' && url.pathname === '/api/work-orders') return json({ data: (await all(env, `SELECT w.*,e.code AS equipment_code,e.description AS equipment_description FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY CASE w.status WHEN 'aberta' THEN 1 WHEN 'em andamento' THEN 2 ELSE 3 END,w.created_at DESC`, user.company_id)).map(normalizeOrder) });
  if (method === 'POST' && url.pathname === '/api/work-orders') {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    if (!await limitCheck(env, user, 'work_orders', 'workOrders')) return error(409, 'O limite do plano atual foi atingido.');
    const input = await jsonBody(req), count = await first(env, 'SELECT COUNT(*) AS count FROM work_orders WHERE company_id=?', user.company_id), row = { id: id(), company_id: user.company_id, equipment_id: clean(input.equipmentId, 40) || null, number: `OS-${String(Number(count.count) + 1).padStart(4, '0')}`, description: clean(input.description, 500), priority: clean(input.priority, 20) || 'normal', responsible: clean(input.responsible, 120), status: 'aberta', scheduled_for: dateOnly(input.scheduledFor), labor_cost: Math.max(0, number(input.laborCost)), material_cost: Math.max(0, number(input.materialCost)), notes: clean(input.notes, 1000) };
    if (!row.description || !['baixa','normal','alta','crítica'].includes(row.priority)) return error(400, 'Descrição e prioridade válida são obrigatórias.');
    if (row.equipment_id && !await companyRecord(env, 'equipment', row.equipment_id, user.company_id)) return error(400, 'Equipamento inválido para esta empresa.');
    await run(env, 'INSERT INTO work_orders (id,company_id,equipment_id,number,description,priority,responsible,status,scheduled_for,labor_cost,material_cost,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', row.id,row.company_id,row.equipment_id,row.number,row.description,row.priority,row.responsible,row.status,row.scheduled_for,row.labor_cost,row.material_cost,row.notes);
    return json({ data: normalizeOrder(row) }, 201);
  }
  const orderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)$/);
  if (method === 'PATCH' && orderMatch) {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    const existing = await companyRecord(env, 'work_orders', orderMatch[1], user.company_id); if (!existing) return error(404, 'Ordem de serviço não encontrada.');
    const input = await jsonBody(req), status = clean(input.status ?? existing.status, 20); if (!['aberta','em andamento','concluída','cancelada'].includes(status)) return error(400, 'Status inválido.');
    const next = { ...existing, description: clean(input.description ?? existing.description, 500), priority: clean(input.priority ?? existing.priority, 20), responsible: clean(input.responsible ?? existing.responsible, 120), status, scheduled_for: dateOnly(input.scheduledFor ?? existing.scheduled_for), executed_at: status === 'concluída' ? (existing.executed_at || nowIso()) : existing.executed_at, closed_at: status === 'concluída' ? nowIso() : existing.closed_at, labor_cost: Math.max(0, number(input.laborCost ?? existing.labor_cost)), material_cost: Math.max(0, number(input.materialCost ?? existing.material_cost)), notes: clean(input.notes ?? existing.notes, 1000) };
    await run(env, 'UPDATE work_orders SET description=?,priority=?,responsible=?,status=?,scheduled_for=?,executed_at=?,closed_at=?,labor_cost=?,material_cost=?,notes=? WHERE id=? AND company_id=?', next.description,next.priority,next.responsible,next.status,next.scheduled_for,next.executed_at,next.closed_at,next.labor_cost,next.material_cost,next.notes,next.id,next.company_id);
    return json({ data: normalizeOrder(next) });
  }
  if (method === 'GET' && url.pathname === '/api/preventive') return json({ data: await all(env, 'SELECT p.*,e.code AS equipment_code,e.description AS equipment_description FROM preventive_plans p LEFT JOIN equipment e ON e.id=p.equipment_id WHERE p.company_id=? ORDER BY p.next_due', user.company_id) });
  if (method === 'POST' && url.pathname === '/api/preventive') {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    const input = await jsonBody(req), row = { id: id(), company_id: user.company_id, equipment_id: clean(input.equipmentId, 40) || null, title: clean(input.title, 140), task: clean(input.task, 500), frequency_days: Math.max(1, Math.round(number(input.frequencyDays, 30))), next_due: dateOnly(input.nextDue) };
    if (!row.title || !row.task || !row.next_due) return error(400, 'Título, tarefa e próxima data são obrigatórios.');
    if (row.equipment_id && !await companyRecord(env, 'equipment', row.equipment_id, user.company_id)) return error(400, 'Equipamento inválido para esta empresa.');
    await run(env, 'INSERT INTO preventive_plans (id,company_id,equipment_id,title,task,frequency_days,next_due) VALUES (?,?,?,?,?,?,?)', row.id,row.company_id,row.equipment_id,row.title,row.task,row.frequency_days,row.next_due); return json({ data: row }, 201);
  }
  if (method === 'GET' && url.pathname === '/api/materials') return json({ data: (await all(env, 'SELECT *,current_stock <= minimum_stock AS low_stock FROM materials WHERE company_id=? ORDER BY name', user.company_id)) });
  if (method === 'POST' && url.pathname === '/api/materials') {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    const input = await jsonBody(req), row = { id: id(), company_id: user.company_id, sku: clean(input.sku, 40), name: clean(input.name, 160), unit: clean(input.unit, 20) || 'un', current_stock: Math.max(0, number(input.currentStock)), minimum_stock: Math.max(0, number(input.minimumStock)), unit_cost: Math.max(0, number(input.unitCost)) };
    if (!row.sku || !row.name) return error(400, 'SKU e nome são obrigatórios.');
    try { await run(env, 'INSERT INTO materials (id,company_id,sku,name,unit,current_stock,minimum_stock,unit_cost) VALUES (?,?,?,?,?,?,?,?)', row.id,row.company_id,row.sku,row.name,row.unit,row.current_stock,row.minimum_stock,row.unit_cost); return json({ data: row }, 201); } catch { return error(409, 'O SKU já existe nesta empresa.'); }
  }
  const movementMatch = url.pathname.match(/^\/api\/materials\/([^/]+)\/movements$/);
  if (method === 'POST' && movementMatch) {
    if (!roleAllowed(user, 'technician')) return error(403, 'Seu perfil não possui permissão para esta ação.');
    const material = await companyRecord(env, 'materials', movementMatch[1], user.company_id); if (!material) return error(404, 'Material não encontrado.');
    const input = await jsonBody(req), type = clean(input.type, 10), quantity = number(input.quantity); if (!['entrada','saída'].includes(type) || quantity <= 0) return error(400, 'Tipo e quantidade válidos são obrigatórios.');
    if (type === 'saída' && material.current_stock < quantity) return error(409, 'Saldo insuficiente para esta saída.');
    const nextStock = material.current_stock + (type === 'entrada' ? quantity : -quantity);
    await batch(env, [bind(env, 'UPDATE materials SET current_stock=? WHERE id=? AND company_id=?', nextStock, material.id, user.company_id), bind(env, 'INSERT INTO stock_movements (id,company_id,material_id,type,quantity,reason) VALUES (?,?,?,?,?,?)', id(), user.company_id, material.id, type, quantity, clean(input.reason, 240))]);
    return json({ data: { ...material, current_stock: nextStock } }, 201);
  }
  if (method === 'GET' && url.pathname === '/api/reports/summary') {
    const rows = await all(env, 'SELECT w.number,w.description,w.status,w.priority,w.opened_at,w.closed_at,e.code AS equipment_code,w.labor_cost,w.material_cost,(w.labor_cost+w.material_cost) AS total_cost FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY w.created_at DESC', user.company_id);
    return json({ data: rows, totals: { orders: rows.length, cost: rows.reduce((sum, row) => sum + Number(row.total_cost || 0), 0) } });
  }
  if (method === 'GET' && url.pathname === '/api/reports/export.csv') {
    const rows = await all(env, 'SELECT w.number,w.description,w.status,w.priority,e.code AS equipment_code,w.labor_cost,w.material_cost,(w.labor_cost+w.material_cost) AS total_cost FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id WHERE w.company_id=? ORDER BY w.created_at DESC', user.company_id);
    const csv = ['Número;Descrição;Status;Prioridade;Equipamento;Mão de obra;Materiais;Total', ...rows.map((row) => [row.number,row.description,row.status,row.priority,row.equipment_code || '',row.labor_cost,row.material_cost,row.total_cost].map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';'))].join('\n');
    return new Response(`\ufeff${csv}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="omnia-relatorio-os.csv"' } });
  }
  if (method === 'POST' && url.pathname === '/api/payments/checkout') return checkout(req, env, user);
  return error(404, 'Recurso não encontrado.');
}

function publicOrigin(env, req) {
  try { const url = new URL(env.PUBLIC_URL || req.url); return url.origin; } catch { return null; }
}
async function mercadoPagoRequest(env, endpoint, payload) {
  const response = await fetch(`https://api.mercadopago.com${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(data.message || 'Mercado Pago recusou a solicitação.');
  return data;
}
async function checkout(req, env, user) {
  if (!roleAllowed(user, 'admin')) return error(403, 'Seu perfil não possui permissão para esta ação.');
  const input = await jsonBody(req), plan = clean(input.plan, 30), product = planProducts[plan], mode = env.BILLING_MODE || 'sandbox', origin = publicOrigin(env, req);
  if (!product) return error(400, 'Escolha um plano pago válido.');
  if (!['sandbox', 'live'].includes(mode) || !env.MP_ACCESS_TOKEN || !origin || (mode === 'live' && (env.DEMO_MODE === 'true' || !origin.startsWith('https://')))) return json({ status: 'manual_setup_required', message: 'Checkout ainda não configurado para este ambiente.' }, 503);
  try { const subscription = await mercadoPagoRequest(env, '/preapproval', { reason: product.title, external_reference: `company:${user.company_id}`, payer_email: user.email, back_url: origin, notification_url: `${origin}/api/payments/webhook`, status: 'pending', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: product.amount, currency_id: 'BRL' } }); return json({ status: 'created', plan, subscriptionId: subscription.id, checkoutUrl: subscription.init_point || null }, 201); } catch { return error(502, 'Não foi possível criar a assinatura no Mercado Pago agora.'); }
}
function signatureParts(value) { return Object.fromEntries(String(value || '').split(',').map((part) => part.split('=').map((item) => item.trim())).filter(([key, val]) => key && val)); }
async function hmacHex(secret, value) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  return crypto.subtle.timingSafeEqual(left, right);
}
async function webhook(req, env, url) {
  if (!env.MP_WEBHOOK_SECRET) return error(503, 'Webhook não configurado.');
  const input = await jsonBody(req), signature = signatureParts(req.headers.get('x-signature')), requestId = req.headers.get('x-request-id') || '', dataId = String(input?.data?.id || url.searchParams.get('data.id') || '');
  if (!signature.ts || !signature.v1 || !requestId || !dataId) return error(401, 'Assinatura do webhook inválida.');
  const expected = await hmacHex(env.MP_WEBHOOK_SECRET, `id:${dataId};request-id:${requestId};ts:${signature.ts};`); if (!await constantTimeEqual(expected, signature.v1)) return error(401, 'Assinatura do webhook inválida.');
  const type = clean(input?.type || url.searchParams.get('type'), 80), resourceId = clean(input?.data?.id || url.searchParams.get('data.id'), 120);
  if (!resourceId) return error(400, 'Evento sem identificador de recurso.');
  if (type !== 'subscription_preapproval') return json({ received: true, processed: false, ignored: true });
  try {
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`, { headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } }); if (!response.ok) return error(502, 'Não foi possível consultar o status da assinatura.');
    const subscription = await response.json(), externalId = `subscription_preapproval:${subscription.id}:${subscription.status}`;
    if (await first(env, 'SELECT id FROM payment_events WHERE external_id=?', externalId)) return json({ received: true, duplicate: true });
    const companyId = String(subscription.external_reference || '').replace(/^company:/, ''), productPlan = Object.entries(planProducts).find(([, product]) => Math.abs(Number(subscription.auto_recurring?.transaction_amount) - product.amount) < 0.01)?.[0] || null;
    const status = subscription.status === 'authorized' ? 'active' : subscription.status === 'paused' ? 'past_due' : subscription.status === 'cancelled' ? 'canceled' : 'manual_review';
    await batch(env, [bind(env, 'INSERT INTO payment_events (id,company_id,external_id,status,payload) VALUES (?,?,?,?,?)', id(), companyId || null, externalId, subscription.status || 'unknown', JSON.stringify(subscription)), ...(companyId && productPlan ? [bind(env, 'UPDATE companies SET plan=?,plan_status=? WHERE id=?', status === 'canceled' ? 'free' : productPlan, status, companyId)] : [])]);
    return json({ received: true, processed: Boolean(companyId && productPlan), status: subscription.status });
  } catch { return error(502, 'Falha ao processar o webhook.'); }
}

export default {
  async fetch(req, env) {
    try {
      await seed(env);
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) return await api(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (cause) {
      console.error(cause);
      return error(500, 'Erro interno. Consulte os logs do serviço.');
    }
  }
};
