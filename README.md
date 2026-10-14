# Pokeprueba

Juego de Pokémon para el navegador, hecho con herramientas gratuitas.

## Cómo jugar en local

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (normalmente http://localhost:5173).

Controles: flechas o WASD para moverte, **Z / Enter / Espacio** para interactuar y avanzar texto, **X / Esc** para ver tu equipo y la mochila. En combate también se puede usar el ratón. La partida se guarda sola en el navegador.

Lo que ya funciona:

- Los mapas de Pokémon Essentials BES (Pueblo Empanada, Ruta 1, casas...) convertidos a Tiled, con sus tilesets, autotiles, colisiones y saltos de bordillo.
- Puertas, salidas y conexiones entre mapas; NPCs que se giran y dicen sus textos.
- Encuentros salvajes con las tablas de `encounters.txt` (de día y de noche) y movimientos aprendidos por nivel de `pokemon.txt`.
- Combates con el motor real de Pokémon Showdown, con los sprites, fondos y nombres en español de Essentials.
- Cambiar de Pokémon, huir, y que los PS se mantengan entre combates. Volver a casa o entrar en un Centro Pokémon cura al equipo.

## Arquitectura

| Pieza | Herramienta | Para qué |
|---|---|---|
| Motor de juego | [Phaser 4](https://phaser.io) + TypeScript | Escenas, render, input, animaciones |
| Empaquetado | [Vite](https://vite.dev) | Servidor de desarrollo y build estático |
| Mapas | [Tiled](https://www.mapeditor.org) | Mapas importados de Essentials (`public/assets/essentials/maps/*.tmj`) |
| Combate | [@pkmn/sim](https://github.com/pkmn/ps) (Showdown) | Toda la lógica de combate, en el navegador |
| Datos online (siguiente fase) | [Supabase](https://supabase.com) | Cuentas, partidas guardadas, combates/intercambios entre jugadores |
| Publicación | GitHub Pages | Jugar desde una URL sin servidor propio |

```
src/
  main.ts              configuración de Phaser (512x384, como Essentials)
  scenes/
    BootScene.ts       carga de datos de Essentials y fuente
    WorldScene.ts      mapas, movimiento, eventos, puertas, conexiones y encuentros
    BattleScene.ts     interfaz de combate
    DialogScene.ts     caja de texto del mundo, con opciones (Sí/No, tiendas)
  world/
    character.ts       personajes del mapa (jugador y eventos): pasos, saltos, gráficos
    interpreter.ts     intérprete de eventos de RPG Maker XP y scripts de Essentials
    text.ts            códigos de los mensajes (\PN, \v[n], colores)
    mapAnimations.ts   animaciones del mapa de Essentials (hierba, polvo, "!")
  battle/
    engine.ts          envoltorio de @pkmn/sim (jugador vs IA)
    protocol.ts        traduce el protocolo de Showdown a eventos y textos en español
  data/
    essentials.ts      datos importados (especies, movimientos, mapas, encuentros)
    party.ts           equipo del jugador
public/assets/essentials/  recursos generados por el importador
tools/import_essentials.py importa un proyecto de Essentials BES
```

El simulador de Showdown se carga solo al entrar en el primer combate, así el mapa arranca rápido.

### Importar desde Pokémon Essentials BES

Los recursos de `public/assets/essentials/` salen de un proyecto de Essentials BES con:

```bash
python3 -m pip install rubymarshal pillow
python3 tools/import_essentials.py "ruta/a/Pokémon Essentials BES"
```

El script lee `Data/` (mapas `.rxdata`, tilesets), `Graphics/` y `PBS/`, y lo regenera todo. Así, si cambias mapas o datos en RPG Maker o en los PBS, basta con volver a ejecutarlo.

Cada mapa convertido es un `.tmj` que se abre en Tiled. Las capas `Suelo*` van debajo del jugador y las `Alto*` por encima; la capa `Eventos` guarda puertas, NPCs y textos. La colisión y el terreno (hierba, bordillos, agua) van precalculados en las propiedades `pasos` y `terreno` del mapa, así que si editas un mapa a mano en Tiled esas propiedades no se actualizan solas.

Los eventos se exportan completos (todas sus páginas y comandos) y el juego los ejecuta como RPG Maker XP, así que la historia se crea en el editor de eventos de RPG Maker y basta con volver a importar. El intérprete entiende:

- Páginas con condiciones (interruptores, variable, interruptor local) y disparadores (botón de acción, contacto, automático, proceso paralelo).
- Mensajes, opciones (Sí/No y listas), condiciones y ramas, bucles, etiquetas, esperas, interruptores, variables, interruptores locales, dinero y objetos.
- Transferir al jugador, rutas de movimiento (pasos, giros, saltos, velocidad, cambio de gráfico, sonidos), mover eventos, transparencia, tono de pantalla, destellos y temblores, efectos de sonido y curar al equipo.
- Movimiento autónomo de los NPCs (aleatorio, hacia el jugador o ruta personalizada).
- Scripts habituales de Essentials: combates de entrenador (`pbTrainerBattle`, con la vista de los `Trainer(n)`), `pbNoticePlayer`, `pbItemBall`, `pbReceiveItem`, `pbAddPokemon`, `pbPokemonMart` (tienda), `pbConfirmMessage`, `pbSetPokemonCenter`, `pbSet`, `setTempSwitchOn`, `pbSetSelfSwitch`, `pbEraseThisEvent` y condiciones con `$game_switches`, `$game_variables`, dinero y mochila.

Lo que todavía no entiende (música, imágenes, otros scripts) se salta y se avisa una vez en la consola del navegador con `[eventos]`, para saber qué falta.

### Créditos y licencia de los recursos

Pokémon Essentials BES se distribuye bajo **CC BY-NC-SA 4.0**: este proyecto debe seguir siendo no comercial, mantener los créditos (`public/assets/essentials/CREDITOS.txt`) y compartirse con la misma licencia. Pokémon y sus personajes son propiedad de Nintendo, Game Freak y The Pokémon Company; esto es un fangame sin ánimo de lucro.

## Hoja de ruta

1. **Base jugable** (hecho): mapa, movimiento, encuentros y combate.
2. **Recursos de Pokémon Essentials BES** (hecho): mapas, tilesets, personajes, sprites y datos en español.
3. **Progresión** (hecho): experiencia, subida de nivel, aprender movimientos, evolución por nivel, captura con Poké Balls, mochila, guardado local, Centro Pokémon (la enfermera cura y es donde vuelves al perder) y entrenadores de los mapas de Essentials (te ven, vienen a por ti y dan dinero). Pendiente: tiendas y objetos curativos.
4. **Mundo**: intérprete de eventos de RPG Maker XP (hecho): la historia se crea en el editor de eventos de Essentials. Pendiente: música, imágenes y más scripts de Essentials según se vayan necesitando.
5. **Supabase**: inicio de sesión, guardado en la nube, Pokédex.
6. **Online**: combates entre jugadores (Supabase Realtime + validación con el simulador) e intercambios.
7. **Pulido**: animaciones de ataques y estados de Essentials (fluidas, con golpe, clima y ataques de dos turnos), transición y entrada al combate, sacar Pokémon con grito, barras de PS y experiencia animadas, debilitarse, lanzamiento de Poké Ball, hierba, polvo y bocadillos en el mapa (hecho). Pendiente: música de fondo, menús, móvil/táctil.
