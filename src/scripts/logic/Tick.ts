import { OnTileExplored, getScienceFromWorkers } from "../../../shared/logic/BuildingLogic";
import { Config } from "../../../shared/logic/Config";
import { GameState } from "../../../shared/logic/GameState";
import {
   getGameOptions,
   getGameState,
   notifyGameStateUpdate,
   serializeSaveLite,
} from "../../../shared/logic/GameStateLogic";
import { calculateHappiness } from "../../../shared/logic/HappinessLogic";
import { clearIntraTickCache, getSpecialBuildings } from "../../../shared/logic/IntraTickCache";
import { OnResetTile } from "../../../shared/logic/TechLogic";
import { CurrentTickChanged, EmptyTickData, Tick, freezeTickData } from "../../../shared/logic/TickLogic";
import {
   OnBuildingComplete,
   OnBuildingProductionComplete,
   OnShowFloater,
   tickPrice,
   tickTech,
   tickTiles,
   tickTransportations,
} from "../../../shared/logic/Update";
import { forEach, safeAdd } from "../../../shared/utilities/Helper";
import { saveGame } from "../Global";
import { isSteam } from "../rpc/SteamClient";
import { WorldScene } from "../scenes/WorldScene";
import { makeObservableHook } from "../utilities/Hook";
import { Singleton } from "../utilities/Singleton";
import { onBuildingComplete } from "./OnBuildingComplete";
import { onProductionComplete } from "./OnProductionComplete";
import { onTileExplored } from "./OnTileExplored";

export function shouldTick(): boolean {
   return isSteam() || document.visibilityState === "visible";
}

let timeSinceLastTick = 0;
export function tickEveryFrame(gs: GameState, dt: number) {
   timeSinceLastTick = Math.min(timeSinceLastTick + dt, 1);
   const worldScene = Singleton().sceneManager.getCurrent(WorldScene);
   if (worldScene) {
      gs.tiles.forEach((tile, xy) => {
         if (tile.building != null) {
            worldScene.getTile(xy)?.update(gs, dt);
         }
      });
      worldScene.updateTransportVisual(gs, timeSinceLastTick);
   }
}

const heartbeatFreq = import.meta.env.DEV ? 10 : 60;
const saveFreq = 5;

export function tickEverySecond(gs: GameState, offline: boolean) {
   // We should always tick when offline
   if (!offline && !shouldTick()) {
      return;
   }
   timeSinceLastTick = 0;
   Tick.current = freezeTickData(Tick.next);
   Tick.next = EmptyTickData();
   clearIntraTickCache();

   forEach(gs.unlockedTech, (tech) => {
      tickTech(Config.Tech[tech]);
   });

   forEach(gs.greatPeople, (person, level) => {
      const greatPerson = Config.GreatPerson[person];
      greatPerson.tick(greatPerson, level, false);
   });

   forEach(getGameOptions().greatPeople, (person, v) => {
      const greatPerson = Config.GreatPerson[person];
      greatPerson.tick(greatPerson, v.level, true);
   });

   tickPrice(gs);
   tickTransportations(gs);
   tickTiles(gs, offline);

   Tick.next.happiness = calculateHappiness(gs);
   const { scienceFromWorkers } = getScienceFromWorkers(gs);
   safeAdd(getSpecialBuildings(gs).Headquarter.building.resources, "Science", scienceFromWorkers);

   ++gs.tick;

   if (!offline) {
      const speed = Singleton().ticker.speedUp;
      if (gs.tick % speed === 0) {
         CurrentTickChanged.emit(Tick.current);
         notifyGameStateUpdate();
      }
      if (gs.tick % (saveFreq * speed) === 0) {
         saveGame(false).catch(console.error);
      }
      if (gs.tick % (heartbeatFreq * speed) === 1) {
         Singleton().heartbeat.update(serializeSaveLite());
      }
   }
}

// Make sure we do event subscription here. If we do it in the individual file, it might mistakenly get
// eliminated by the dead code elimination!

OnShowFloater.on(({ xy, amount }) => {
   Singleton().sceneManager.getCurrent(WorldScene)?.getTile(xy)?.showFloater(amount);
});
OnResetTile.on((xy) => {
   Singleton().sceneManager.getCurrent(WorldScene)?.resetTile(xy);
});
OnTileExplored.on(onTileExplored);
OnBuildingComplete.on(onBuildingComplete);
OnBuildingProductionComplete.on(onProductionComplete);

export const useCurrentTick = makeObservableHook(CurrentTickChanged, () => Tick.current);

if (import.meta.env.DEV) {
   // @ts-expect-error
   window.tickGameState = (tick: number) => {
      const gs = getGameState();
      for (let i = 0; i < tick; i++) {
         tickEverySecond(gs, true);
      }
   };
   // @ts-expect-error
   window.benchmarkTick = (tick: number) => {
      console.time(`TickGameState(${tick})`);
      const gs = getGameState();
      for (let i = 0; i < tick; i++) {
         tickEverySecond(gs, true);
      }
      console.timeEnd(`TickGameState(${tick})`);
   };
   // @ts-expect-error
   window.Config = Config;
}
