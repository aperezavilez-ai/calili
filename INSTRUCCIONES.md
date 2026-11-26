# Instrucciones de Calili

Este archivo se mantiene por compatibilidad.  
La documentación oficial y actualizada está en:

- **README.md** → instalación, variables de entorno y uso general
- **DEPLOY.md** → despliegue en Vercel + Supabase
- **supabase/migrations/001_schema.sql** → esquema de base de datos

### Pasos rápidos

1. `cp .env.example .env.local` y rellena las claves.
2. Ejecuta el SQL de `supabase/migrations/001_schema.sql` en Supabase.
3. `npm install && npm run dev`
