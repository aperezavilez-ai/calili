# Despliegue de Calili

## 1. Requisitos previos

- Cuenta en [Vercel](https://vercel.com)
- Proyecto en [Supabase](https://supabase.com)
- Al menos una clave de motor: `MEAI_API_KEY` o `GROQ_API_KEY`

## 2. Base de datos

1. Entra a tu proyecto Supabase → **SQL Editor**.
2. Copia y ejecuta el contenido completo de:

   ```
   supabase/migrations/001_schema.sql
   ```

3. Verifica que aparezca el mensaje:  
   `✅ Calili schema (public) aplicado correctamente`

## 3. Variables de entorno en Vercel

En el proyecto de Vercel → **Settings → Environment Variables** añade:

### Obligatorias (al menos un motor + Supabase)

| Variable                        | Descripción                          |
|---------------------------------|--------------------------------------|
| `MEAI_API_KEY`                  | Clave principal (recomendada)        |
| `GROQ_API_KEY`                  | Respaldo                             |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL del proyecto Supabase            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon pública                   |
| `NEXT_PUBLIC_APP_URL`           | https://calili.vercel.app (o tu dominio) |

### Opcionales pero recomendadas

| Variable               | Descripción                              |
|------------------------|------------------------------------------|
| `GOOGLE_AI_API_KEY`    | Imágenes, vídeo y música                 |
| `TAVILY_API_KEY`       | Búsqueda web                             |
| `OPENAI_API_KEY`       | Voz premium + edición de imágenes        |
| `AVATAR_SERVICE_URL`   | Servicio de avatar (GPU)                 |
| `AVATAR_SERVICE_TOKEN` | Token del servicio de avatar             |

## 4. Deploy

1. Conecta el repositorio GitHub a Vercel.
2. Framework preset: **Next.js**.
3. Deploy.

## 5. Comprobaciones post-deploy

- [ ] La app carga en el dominio.
- [ ] Puedes iniciar sesión (Supabase Auth).
- [ ] El chat responde (prueba un mensaje simple).
- [ ] Se guardan conversaciones al refrescar.
- [ ] La PWA se puede instalar (Chrome / Safari).

## Notas

- El esquema oficial es **public** (no `calili`).
- No uses la clave `service_role` en el frontend.
- En desarrollo local puedes dejar Supabase vacío: la app funciona solo con almacenamiento local.
