# OMNIA PCM Lite

MVP responsivo/PWA em português brasileiro para pequenas operações de manutenção. O produto cobre painel, equipamentos, ordens de serviço, preventivas, estoque, relatórios CSV, cadastro inicial de empresa e isolamento multiempresa no backend.

## Rodar localmente

```powershell
npm install
npm start
```

Abra `http://localhost:3000`. A demonstração usa `admin@omnia.local` / `omnia123!`.

Para habilitar a conta e os dados de demonstração, use `DEMO_MODE=true`. Em uma instância comercial, mantenha `DEMO_MODE=false` (ou remova a variável) e crie a primeira conta pelo cadastro; assim, a instalação não nasce com credenciais conhecidas.

## Arquitetura

- Node.js + Express 5.
- SQLite via `better-sqlite3`, com migração em `migrations/001_init.sql`.
- Sessão HTTP em cookie HttpOnly com token armazenado apenas como hash.
- Senhas com bcrypt; Helmet; validação server-side; consultas sempre filtradas por `company_id`.
- A conta e os dados de demonstração são controlados explicitamente por `DEMO_MODE` e não devem ser habilitados em uma instância comercial.
- Frontend sem framework, responsivo e instalável como PWA.

## Pagamentos

O painel autenticado inclui a área **Plano e cobrança**. O endpoint `/api/payments/checkout` cria uma assinatura mensal do plano escolhido via API oficial do Mercado Pago quando `MP_ACCESS_TOKEN` e `PUBLIC_URL` HTTPS estiverem configurados. O webhook exige `MP_WEBHOOK_SECRET`, valida `x-signature`, consulta o status oficial da assinatura e registra eventos de forma idempotente antes de atualizar o plano da empresa. No ambiente atual, o fluxo está preparado para sandbox; não anunciar cobrança real antes da ativação de produção e de um teste completo com dados operacionais persistentes.

## Implantação pública de demonstração

O arquivo `render.yaml` prepara uma implantação gratuita no Render. Ela é adequada para demonstração e validação inicial: o plano gratuito pode dormir após inatividade e o SQLite fica em filesystem efêmero. Não use essa configuração para dados reais ou clientes pagantes sem migrar para banco persistente, backups, domínio/HTTPS e revisar segurança, privacidade e recuperação de conta.

Para aplicar o Blueprint:

1. Abra `https://dashboard.render.com/blueprint/new?repo=https://github.com/Lthighway/omnia-pcm-lite`.
2. Confirme o serviço `omnia-pcm-lite-demo` e mantenha o plano gratuito para teste.
3. Configure `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `PUBLIC_URL` somente no ambiente protegido do provedor, nunca no repositório.
4. Para a prévia pública atual, mantenha `DEMO_MODE=true`; para uma operação comercial, use `DEMO_MODE=false`, banco persistente e credenciais de produção separadas.
5. Clique em **Apply** e teste `/api/health` antes de divulgar o endereço.

## Limitações conhecidas do MVP

- Ainda não há recuperação de senha por e-mail, PDF server-side, gestão completa de usuários pela interface ou geração automática de OS a partir da preventiva.
- O checkout de teste está configurado no Render; a ativação de pagamento em produção depende de dados comerciais, credenciais de produção e teste do webhook em ambiente público.
- Render Free não é adequado para produção: o filesystem é efêmero, o Postgres gratuito expira e não há backups; use-o somente para prévia/teste e configure banco persistente/backup antes de clientes reais.

## Testes

```powershell
npm test
```

Os testes usam dados fictícios e exercitam cadastro/login, isolamento entre empresas, ordens, custos, estoque, permissões, relatórios e bloqueio do checkout sem credenciais.
