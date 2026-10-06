# Comparación mensual de presupuesto

Esta entrega compara, en la hoja de costos por categoría, el presupuesto ejecutado con el planeado del mes que esté filtrado. El reporte nuevo queda detrás de un código en el menú **Admin**.

## Entrega

| Qué pidieron | Dónde está |
|---|---|
| Hoja con el menú nuevo | [Copia con el menú Admin](https://docs.google.com/spreadsheets/d/1GWBxecKc03_328_c1sHeC3cTEwn7ZEuNJtT3UPShSAc/edit?gid=1153956257#gid=1153956257) |
| Código de Apps Script | Este repositorio |
| Misma integración en varias copias | [Hoja de despliegue masivo](https://docs.google.com/spreadsheets/d/1BEW_HKx9ITPj13IsIauEFPS_dzkRkCQlJEl3lfuqU7A/edit?gid=1610481568#gid=1610481568) |

## Cómo probarlo

1. Abrir la [copia con el menú Admin](https://docs.google.com/spreadsheets/d/1GWBxecKc03_328_c1sHeC3cTEwn7ZEuNJtT3UPShSAc/edit?gid=1153956257#gid=1153956257) con una cuenta que pueda editarla.
2. Recargar la hoja. En la barra aparece **Admin → Enable with admin code**.
3. Ingresar el código de administrador. El menú pasa a **Monthly Comparative Report**.
4. En `Monthly Budget`, dejar el mes que se quiere comparar (`F2` año, `F3` mes, `H2` inicio, `H3` fin).
5. Ejecutar **Monthly Comparative Report**. La hoja crea o reemplaza la pestaña `{Mes} Budget Comparison` y deja un borrador en Gmail, sin destinatario y sin enviarlo.

## Enfoque

La plantilla que recibimos calcula el costo o presupuesto de cada categoría. El script no recalcula esas fórmulas: lee el mes filtrado y compara el valor actual con el planeado.

El trabajo se hizo en local y se publicó en Google con [clasp](https://github.com/google/clasp), autenticado contra la cuenta dueña de la copia. Así el script quedó ligado a esa copia y no al archivo original.

| Pieza | Decisión |
|---|---|
| Dónde vive el script | Dentro de la hoja, proyecto `1zoymvQblIfvs0OpfS19s0ZZg9iQZWfRuE5zmI3Z-KrXETq5v5DzZaTkt`. No hay servidor aparte. |
| Qué archivo se tocó | Solo `Code.js`. `charts.js`, `buckets.js`, `onEdit.js`, `Print.js` y `Tab Order.js` siguen igual, porque los botones de la plantilla los llaman por nombre. |
| Menú | Al abrir, **Admin** pide el código. Si es correcto, habilita el reporte del mes. **Require admin code again** vuelve a bloquearlo. |
| Comparación | Lee `Monthly Budget`. El total de cada grupo (`Total …`) es el que manda. Plan es la columna D y real es la columna F. |
| Umbral | Si la desviación llega al 15 % o más, la categoría queda `Over` o `Under`, con la frase (`Shelter is over budget by 20%.`) y solo los conceptos que también pasan ese umbral. |
| Runtime | V8. El runtime anterior de la copia ya no ejecuta scripts. |
| Masificar | `deploy/` es otro proyecto de Apps Script, ligado a la [hoja de despliegue](https://docs.google.com/spreadsheets/d/1BEW_HKx9ITPj13IsIauEFPS_dzkRkCQlJEl3lfuqU7A/edit?gid=1610481568#gid=1610481568). Su menú **Deploy → Update client copies** copia el reporte a cada URL de la pestaña `Client URLs` y conserva el código que ya tenía esa hoja. |

## Supuestos

- Trabajamos sobre una copia de la plantilla, no sobre el archivo original.
- El filtro del mes ya está resuelto en `Monthly Budget` antes de correr el reporte.
- El total de la fila `Total …` manda. Los conceptos no se vuelven a sumar.
- Se ignoran filas ocultas, el título `Monthly Budget` y los conceptos `-`.
- `Over` y `Under` siguen el signo real menos plan, también en ingresos.
- La columna I de Chart of Accounts (`Script List (Do Not Delete)`) no se modifica.
- El borrador de Gmail queda en la cuenta que ejecuta el reporte. No se envía.

## Publicar de nuevo

Desde la raíz, hacia la copia con el menú Admin:

```bash
clasp push
```

Desde `deploy/`, hacia la hoja que masifica las copias:

```bash
cd deploy && clasp push
```
