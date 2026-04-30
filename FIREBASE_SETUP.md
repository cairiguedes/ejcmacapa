# 🔥 EJC Gincana — Guia de Configuração Firebase
# Segurança por Boas Práticas (estudante de SI)

## 1. CRIAR PROJETO NO FIREBASE

1. Acesse https://console.firebase.google.com
2. Clique em "Adicionar projeto" → dê um nome (ex: `ejc-gincana-2025`)
3. Desative o Google Analytics (opcional para esse projeto)
4. Vá em **Build → Realtime Database → Criar banco de dados**
5. Escolha a região mais próxima (us-central1 ou southamerica-east1)
6. Inicie em **modo de teste** (vamos substituir as regras abaixo)


## 2. OBTER AS CREDENCIAIS

1. No console do Firebase, clique em ⚙️ (Configurações do projeto)
2. Role até "Seus aplicativos" → clique em `</>` (Web)
3. Registre o app com um nome
4. Copie o objeto `firebaseConfig` e cole no `index.html`


## 3. REGRAS DE SEGURANÇA — FIREBASE REALTIME DATABASE

### Estratégia adotada: "Secret Token" (autenticação por segredo compartilhado)
### Adequada para: grupos pequenos e de confiança, sem cadastro de usuários.
### Por quê: evita exposição de dados a qualquer pessoa que encontre o link,
###           sem precisar implementar login completo com email/senha.

### Acesse: Build → Realtime Database → Regras

{
  "rules": {
    ".read": "auth != null || root.child('config/accessToken').val() === query.orderByChild",

    "teams": {
      ".read":  "root.child('config/secret').val() === $secret",
      ".write": "root.child('config/secret').val() === $secret"
    },
    "entries": {
      ".read":  "root.child('config/secret').val() === $secret",
      ".write": "root.child('config/secret').val() === $secret"
    }
  }
}

### ─────────────────────────────────────────────────────────────────────────────
### OPÇÃO RECOMENDADA (mais simples e segura para o seu caso):
### Use Autenticação Anônima com regra baseada em domínio + UID whitelist
### ─────────────────────────────────────────────────────────────────────────────

### PASSO A PASSO — Método recomendado:

### A) No Firebase Console:
###    Authentication → Sign-in method → Habilitar "Anônimo"

### B) No app.js, adicione ANTES de usar o banco:
###    import { getAuth, signInAnonymously } from "firebase/auth";
###    const auth = getAuth(app);
###    await signInAnonymously(auth);

### C) Regras de Segurança (cole no console do Firebase):

{
  "rules": {
    "teams": {
      ".read":  "auth != null",
      ".write": "auth != null",
      "$teamId": {
        ".validate": "newData.hasChildren(['name', 'color'])"
      }
    },
    "entries": {
      ".read":  "auth != null",
      ".write": "auth != null",
      "$entryId": {
        ".validate": "newData.hasChildren(['teamId', 'points', 'date', 'type'])
                      && newData.child('points').isNumber()
                      && newData.child('date').isString()
                      && newData.child('date').val().length === 10"
      }
    }
  }
}

### EXPLICAÇÃO DAS REGRAS:
### - auth != null       → só quem está autenticado (mesmo anonimamente) pode ler/gravar
### - .validate          → valida o formato dos dados antes de salvar (evita lixo no banco)
### - Sem essas regras   → qualquer pessoa com o URL do banco pode ler/escrever TUDO

### ─────────────────────────────────────────────────────────────────────────────
### NÍVEL AVANÇADO (se quiser depois): autenticação por e-mail/senha
### Adicione líderes com e-mail/senha no Firebase Auth e mude as regras para:
### ".write": "auth.token.email_verified === true"
### ─────────────────────────────────────────────────────────────────────────────


## 4. ADICIONAR AUTENTICAÇÃO ANÔNIMA AO index.html

### Substitua o bloco <script type="module"> no index.html por este:

<script type="module">
  import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getDatabase, ref, push, onValue, remove, set, get }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
  import { getAuth, signInAnonymously }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

  const firebaseConfig = { /* sua config aqui */ };

  const app  = initializeApp(firebaseConfig);
  const db   = getDatabase(app);
  const auth = getAuth(app);

  // Autenticação silenciosa antes de usar o banco
  await signInAnonymously(auth);

  window._fb = { db, ref, push, onValue, remove, set, get };
  document.dispatchEvent(new Event("firebase-ready"));
</script>


## 5. DOMÍNIOS AUTORIZADOS (importante!)

### Firebase Console → Authentication → Settings → Authorized domains
### Adicione APENAS o domínio onde o app estará hospedado.
### Se for usar GitHub Pages: seuusuario.github.io
### Se for usar Netlify/Vercel: o domínio gerado lá


## 6. HOSPEDAGEM GRATUITA RECOMENDADA

### Opção 1: Firebase Hosting (ideal, mesma plataforma)
###   npm install -g firebase-tools
###   firebase login
###   firebase init hosting
###   firebase deploy

### Opção 2: GitHub Pages (grátis, simples)
###   1. Crie repositório privado no GitHub
###   2. Faça upload dos arquivos
###   3. Settings → Pages → branch main → /root
###   4. Acesse: https://seuusuario.github.io/ejc-gincana


## 7. ÍCONES DO PWA

### Gere os ícones em: https://realfavicongenerator.net
### Coloque icon-192.png e icon-512.png na mesma pasta do index.html
### Use uma imagem com o símbolo EJC ou uma cruz estilizada


## 8. CHECKLIST FINAL DE SEGURANÇA ✅

[ ] Regras do Realtime Database configuradas (não em modo teste)
[ ] Autenticação anônima habilitada
[ ] Domínios autorizados configurados
[ ] Variáveis do firebaseConfig NÃO estão em repositório público
[ ] Se repositório público: use variáveis de ambiente (ex: Netlify env vars)
[ ] Validação de dados nas regras do banco (.validate)
[ ] Testou as regras no "Simulador de regras" do Firebase Console


## 9. NOTAS DE SEGURANÇA PARA SEU TCC/ESTUDO

### O firebaseConfig NÃO é uma credencial secreta por si só — é público por design.
### A segurança real vem das REGRAS do banco de dados.
### Para produção real, considere:
###   - Firebase App Check (anti-abuso)
###   - Rate limiting via regras
###   - Logs de auditoria no Firebase
