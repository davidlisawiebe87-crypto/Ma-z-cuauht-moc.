SITIO: MAÍZ CUAUHTÉMOC

QUÉ HACE
- Muestra el contrato CBOT de maíz amarillo diciembre 2026 mediante TradingView.
- Consulta el tipo de cambio USD/MXN.
- Muestra el clima actual y pronóstico de 5 días para Cuauhtémoc, Chihuahua.
- Busca noticias recientes relacionadas con maíz, USDA, CBOT, cosecha y exportaciones.
- Marca como NUEVAS las publicaciones aparecidas desde la última visita.
- Se actualiza cada 15 minutos mientras permanece abierto.
- Puede instalarse en el teléfono como acceso directo/app web.

PUBLICACIÓN RECOMENDADA EN NETLIFY
1. Descomprime este ZIP.
2. Sube la carpeta completa a un repositorio de GitHub.
3. En Netlify elige “Add new site” > “Import an existing project”.
4. Selecciona el repositorio.
5. No necesitas comando de compilación. El directorio de publicación es “.”.
6. Publica el sitio.

IMPORTANTE
- Las funciones de noticias y cotización automática necesitan que Netlify procese la carpeta netlify/functions.
- El clima y el dólar tienen un modo de respaldo directo si la función falla.
- El gráfico de TradingView puede tener retraso.
- La conversión a pesos por tonelada es solo el valor Chicago convertido. No incluye base, flete, almacenamiento ni margen local.

PRUEBA VISUAL
Abre index.html con ?demo=1 al final de la dirección para ver datos de demostración, por ejemplo:
https://tu-sitio.netlify.app/?demo=1
