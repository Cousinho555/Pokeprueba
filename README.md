# Pokeprueba

Juego de Pokémon para el navegador, hecho con herramientas gratuitas.

## Cómo jugar en local

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (normalmente http://localhost:5173).

Controles: flechas o WASD para moverte, **Z / Enter / Espacio** para interactuar y avanzar texto. En combate también se puede usar el ratón.

Lo que ya funciona:

- Un pueblo hecho en Tiled por el que te mueves casilla a casilla, con colisiones.
- Encuentros aleatorios en la hierba alta.
- Combates contra Pokémon salvajes con el motor real de Pokémon Showdown (daño, tipos, críticos, cambios de estadísticas, estados...).
- Cambiar de Pokémon, huir, y que los PS se mantengan entre combates.
- La puerta de la casa cura al equipo; si te debilitan a todos, vuelves a casa.

Los gráficos actuales son provisionales (generados por `tools/gen_assets.py`) para no depender de recursos externos.

## Arquitectura

| Pieza | Herramienta | Para qué |
|---|---|---|
| Motor de juego | [Phaser 4](https://phaser.io) + TypeScript | Escenas, render, input, animaciones |
| Empaquetado | [Vite](https://vite.dev) | Servidor de desarrollo y build estático |
| Mapas | [Tiled](https://www.mapeditor.org) | Edición de mapas (`public/assets/maps/*.tmj`) |
| Combate | [@pkmn/sim](https://github.com/pkmn/ps) (Showdown) | Toda la lógica de combate, en el navegador |
| Datos online (siguiente fase) | [Supabase](https://supabase.com) | Cuentas, partidas guardadas, combates/intercambios entre jugadores |
| Publicación | GitHub Pages | Jugar desde una URL sin servidor propio |

```
src/
  main.ts              configuración de Phaser
  scenes/
    BootScene.ts       carga de recursos y animaciones
    WorldScene.ts      mapa, movimiento por casillas, encuentros
    BattleScene.ts     interfaz de combate
    DialogScene.ts     caja de texto del mundo
  battle/
    engine.ts          envoltorio de @pkmn/sim (jugador vs IA)
    protocol.ts        traduce el protocolo de Showdown a eventos y textos en español
  data/
    party.ts           equipo del jugador
    encounters.ts      tablas de encuentros
public/assets/         tileset, sprites y mapas de Tiled
tools/gen_assets.py    genera los gráficos provisionales
```

El simulador de Showdown se carga solo al entrar en el primer combate, así el mapa arranca rápido.

### Editar el mapa en Tiled

Abre `public/assets/maps/pueblo.tmj` con Tiled. Reglas que entiende el juego:

- Capas de tiles `Suelo` y `Obstaculos`.
- Propiedades booleanas en los tiles del tileset: `colisiona` (no se puede pisar) y `hierba` (puede salir un Pokémon salvaje).
- Capa de objetos `Objetos` con un punto llamado `inicio` (posición inicial del jugador).

Ojo: `npm run gen:assets` regenera el mapa y sobrescribe los cambios hechos a mano.

## Hoja de ruta

1. **Base jugable** (hecho): mapa, movimiento, encuentros y combate.
2. **Recursos de Pokémon Essentials BES**: tilesets, personajes, sprites de Pokémon (`Graphics/`), y datos en español de `PBS/` (especies, movimientos, encuentros) convertidos a JSON con un script.
3. **Progresión**: experiencia y subida de nivel, aprender movimientos, captura con Poké Balls, mochila, centro Pokémon, entrenadores con IA.
4. **Mundo**: varios mapas conectados, NPCs con diálogos, eventos (equivalente a los eventos de RPG Maker).
5. **Supabase**: inicio de sesión, guardado en la nube, Pokédex.
6. **Online**: combates entre jugadores (Supabase Realtime + validación con el simulador) e intercambios.
7. **Pulido**: música y efectos, animaciones de ataques, menús, móvil/táctil.
