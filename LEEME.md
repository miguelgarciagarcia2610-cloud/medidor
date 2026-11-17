# Medidor de tiempo — cómo ponerlo en marcha

Son tres pasos y se hacen una sola vez: crear la base de datos (Supabase), conectar la web con ella (config.js) y publicarla (GitHub Pages). Calcula unos 20 minutos.

## 1. Crear la base de datos en Supabase

1. Entra en https://supabase.com y crea una cuenta gratuita.
2. Pulsa **New project**. Ponle un nombre (por ejemplo `medidor`), elige una contraseña para la base de datos (guárdala, aunque no la vas a necesitar aquí) y como región **Europe (Frankfurt / Paris / London)**. Espera un par de minutos a que se cree.
3. En el menú de la izquierda, abre **SQL Editor** → **New query**. Pega todo el contenido del archivo `supabase.sql` y pulsa **Run**. Debe responder "Success".
4. Ve a **Authentication → Sign In / Providers → Email** y **desactiva "Confirm email"**. Así podrás entrar nada más crear tu cuenta, sin esperar al correo de confirmación.
5. Ve a **Project Settings → API Keys** (o **Data API**) y apunta:
   - la **Project URL** (algo como `https://abcdefghijkl.supabase.co`)
   - la **Publishable key** (empieza por `sb_publishable_`). Si tu proyecto muestra la "anon public key", vale igual.

   No uses nunca la "secret key" ni la "service_role key" en la web.

## 2. Conectar la web con tu base de datos

Abre `config.js` con cualquier editor de texto (o directamente en GitHub, en el paso 3) y rellena las dos líneas:

```js
supabaseUrl: "https://abcdefghijkl.supabase.co",
supabaseKey: "sb_publishable_xxxxxxxxxxxx"
```

## 3. Publicar en GitHub Pages

1. Entra en https://github.com y crea una cuenta si no tienes.
2. Arriba a la derecha: **+ → New repository**. Nombre: `medidor` (por ejemplo). Márcalo como **Public** (GitHub Pages gratis lo necesita; tus datos no están en el repositorio, están en Supabase). Pulsa **Create repository**.
3. En la página del repositorio, pulsa **uploading an existing file** (o **Add file → Upload files**). Arrastra **todo el contenido** de esta carpeta (los archivos y las carpetas `icons` y `vendor`, no la carpeta que los contiene). Pulsa **Commit changes**.
4. Ve a **Settings → Pages**. En "Build and deployment", Source: **Deploy from a branch**, Branch: **main** y carpeta **/ (root)**. Pulsa **Save**.
5. Espera uno o dos minutos y recarga la página: arriba aparecerá tu dirección, del estilo `https://tu-usuario.github.io/medidor/`.

## 4. Primer uso

1. Abre tu dirección, escribe tu email y una contraseña y pulsa **Crear cuenta**.
2. Recomendado, para que nadie más pueda crear cuentas en tu web: en Supabase, **Authentication → Sign In / Providers**, desactiva **"Allow new users to sign up"**. Tú seguirás pudiendo entrar.
3. En el móvil, abre la misma dirección y entra con el mismo email y contraseña. Luego añádela a la pantalla de inicio:
   - iPhone (Safari): botón Compartir → **Añadir a pantalla de inicio**.
   - Android (Chrome): menú ⋮ → **Añadir a pantalla de inicio** o **Instalar aplicación**.

## Cosas útiles

- **Sin conexión**: puedes seguir sumando unidades. Se guardan en el móvil y se suben solas cuando vuelve la conexión. Arriba a la derecha ves el estado (verde = sincronizado).
- **Cambiar categorías**: desde la pestaña Ajustes de la propia app.
- **Actualizar la web**: si te paso una versión nueva, súbela igual (Add file → Upload files) y sobrescribe los archivos. No toques `config.js` si ya lo tienes rellenado.
- **Exportar**: Ajustes → Copiar CSV, y lo pegas en Excel o Google Sheets.
- Supabase pausa los proyectos gratuitos que pasan una semana sin usarse. Si te pasa, entra en supabase.com y pulsa **Restore**. Usándolo a diario no ocurre.
