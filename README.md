# OMNIA PCM Lite

MVP responsivo/PWA em português brasileiro para pequenas operações de manutenção. O produto cobre painel, equipamentos, ordens de serviço, preventivas, estoque, relatórios CSV, cadastro inicial de empresa e isolamento multiempresa no backend.

## Rodar localmente

```powershell
npm install
npm start
```

Abra `http://localhost:3000`. A demonstração usa `admin@omnia.local` / `omnia123!`.

## Arquitetura

- Node.js + Express 5.
- SQLite via `better-sqlite3`, com migração em `migrations/001_init.sql`.
- Sessão HTTP em cookie HttpOnly com token armazenado apenas como hash.
- Senhas com bcrypt; Helmet; validação server-side; consultas sempre filtradas por `company_id`.
- Frontend sem framework, responsivo e instalável como PWA.

## Pagamentos

O endpoint `/api/payments/checkout` permanece explicitamente bloqueado até configurar uma aplicação real do Mercado Pago, um `MP_ACCESS_TOKEN`, URL pública e webhook assinado. Não existe link inventado nem liberação baseada em redirecionamento. O endpoint de webhook é apenas um placeholder seguro: a implementação de produção deve validar `x-signature`, consultar o status oficial, processar eventos de forma idempotente e atualizar o plano.

## Limitações conhecidas do MVP

- Ainda não há recuperação de senha por e-mail, PDF server-side, gestão completa de usuários pela interface, geração automática de OS a partir da preventiva ou integração Mercado Pago.
- A ativação de pagamento não é anunciada como disponível.
- Render Free não é adequado para produção: o filesystem é efêmero, o Postgres gratuito expira e não há backups; use-o somente para prévia/teste e configure banco persistente/backup antes de clientes reais.

## Testes

```powershell
npm test
```

Os testes usam dados fictícios e exercitam cadastro/login, isolamento entre empresas, ordens, custos, estoque, permissões, relatórios e bloqueio do checkout sem credenciais.
