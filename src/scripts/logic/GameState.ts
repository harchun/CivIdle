import type { IPointData } from "pixi.js";
import { v4 } from "uuid";
import type { ChatChannel } from "../../../server/src/Database";
import { getGameOptions, notifyGameOptionsUpdate } from "../Global";
import type { Building } from "../definitions/BuildingDefinitions";
import type { City } from "../definitions/CityDefinitions";
import type { GreatPerson } from "../definitions/GreatPersonDefinitions";
import type { Resource } from "../definitions/ResourceDefinitions";
import type { RomeProvince } from "../definitions/RomeProvinceDefinitions";
import type { Tech } from "../definitions/TechDefinitions";
import type { PartialSet, PartialTabulate } from "../definitions/TypeDefinitions";
import type { Grid } from "../scenes/Grid";
import { forEach, isEmpty, keysOf, pointToTile, shuffle, type Tile } from "../utilities/Helper";
import { L, t } from "../utilities/i18n";
import { Config } from "./Config";
import type { IShortcutConfig, Shortcut } from "./Shortcut";
import { unlockTech } from "./TechLogic";
import { ensureTileFogOfWar, findNearest } from "./TerrainLogic";
import type { IBuildingData, ITileData } from "./Tile";
import { makeBuilding } from "./Tile";

export interface ITransportationData {
   id: number;
   fromXy: Tile;
   toXy: Tile;
   ticksRequired: number;
   ticksSpent: number;
   fromPosition: IPointData;
   toPosition: IPointData;
   resource: Resource;
   amount: number;
   fuel: Resource;
   fuelAmount: number;
   currentFuelAmount: number;
   hasEnoughFuel: boolean;
}

export class GameState {
   city: City = "Rome";
   unlockedTech: PartialSet<Tech> = {};
   unlockedProvince: PartialSet<RomeProvince> = {};
   tiles: Map<Tile, ITileData> = new Map();
   transportation: Map<Tile, ITransportationData[]> = new Map();
   tick = 0;
   greatPeople: PartialTabulate<GreatPerson> = {};
   greatPeopleChoices: GreatPeopleChoice[] = [];
   transportId = 0;
   lastPriceUpdated = 0;
   isOffline = false;
}

export type GreatPeopleChoice = [GreatPerson, GreatPerson, GreatPerson];

export class SavedGame {
   current = new GameState();
   options = new GameOptions();
}

const DefaultThemeColors = {
   WorldBackground: "#1e2328",
   GridColor: "#ffffff",
   GridAlpha: 0.1,
   SelectedGridColor: "#ffff99",
   InactiveBuildingAlpha: 0.5,
   TransportIndicatorAlpha: 0.5,
   ResearchBackground: "#1e2328",
   ResearchLockedColor: "#666666",
   ResearchUnlockedColor: "#ffffff",
   ResearchHighlightColor: "#ffff99",
};

export function resetThemeColor() {
   getGameOptions().themeColors = { ...DefaultThemeColors };
   notifyGameOptionsUpdate();
}

export const ThemeColorNames: Record<keyof typeof DefaultThemeColors, () => string> = {
   WorldBackground: () => t(L.ThemeColorWorldBackground),
   ResearchBackground: () => t(L.ThemeColorResearchBackground),
   GridColor: () => t(L.ThemeColorGridColor),
   GridAlpha: () => t(L.ThemeColorGridAlpha),
   SelectedGridColor: () => t(L.ThemeSelectedGridColor),
   InactiveBuildingAlpha: () => t(L.ThemeInactiveBuildingAlpha),
   TransportIndicatorAlpha: () => t(L.ThemeTransportIndicatorAlpha),
   ResearchLockedColor: () => t(L.ThemeResearchLockedColor),
   ResearchUnlockedColor: () => t(L.ThemeResearchUnlockedColor),
   ResearchHighlightColor: () => t(L.ThemeResearchHighlightColor),
};

export class GameOptions {
   useModernUI = true;
   id = v4();
   token: string | null = null;
   version = SAVE_FILE_VERSION;
   buildingColors: Partial<Record<Building, string>> = {};
   resourceColors: Partial<Record<Resource, string>> = {};
   themeColors = { ...DefaultThemeColors };
   shortcuts: Partial<Record<Shortcut, IShortcutConfig>> = {};
   soundEffect = true;
   buildingDefaults: Partial<Record<Building, Partial<IBuildingData>>> = {};
   defaultPriority = 0x010101;
   chatSendChannel: ChatChannel = "en";
   chatReceiveChannel: PartialSet<ChatChannel> = {};
   isOffline = false;
   // Should be wiped
   greatPeople: Partial<Record<GreatPerson, { level: number; amount: number }>> = {};
   greatPeopleChoices: GreatPeopleChoice[] = [];
}

export const SAVE_FILE_VERSION = 1;

export function initializeGameState(gameState: GameState, grid: Grid) {
   const center = grid.center();
   const centerXy = pointToTile(center);

   grid.forEach((point) => {
      const xy = pointToTile(point);
      if (gameState.tiles.get(xy)) {
         return;
      }
      gameState.tiles.set(xy, {
         tile: xy,
         deposit: {},
         explored: false,
      });
   });

   gameState.tiles.get(centerXy)!.building = makeBuilding({
      type: "Headquarter",
      level: 1,
      status: "completed",
   });

   // forEach(Config.Tech, (k, v) => {
   //    if (v.column === 0) {
   //       unlockTech(k, getTechConfig(gameState), gameState);
   //    }
   // });
   forEach(Config.Tech, (k, v) => {
      if (v.column === 0) {
         unlockTech(k, gameState);
      }
   });

   const wood = findNearest((tile) => !!tile.deposit.Wood, center, grid, gameState);
   if (wood) {
      gameState.tiles.get(wood.tile)!.building = makeBuilding({
         type: "LoggingCamp",
         level: 1,
         status: "completed",
      });
   }

   const stone = findNearest((tile) => !!tile.deposit.Stone, center, grid, gameState);
   if (stone) {
      gameState.tiles.get(stone.tile)!.building = makeBuilding({
         type: "StoneQuarry",
         level: 1,
         status: "completed",
      });
   }

   const water = findNearest((tile) => !!tile.deposit.Water, center, grid, gameState);
   if (water) {
      gameState.tiles.get(water.tile)!.building = makeBuilding({
         type: "Aqueduct",
         level: 1,
         status: "completed",
      });
   }

   // gameState.tiles[pointToXy({ x: center.x + 1, y: center.y + 1 })].building = makeBuilding({ type: "Hut" });

   // gameState.tiles[pointToXy({ x: center.x + 1, y: center.y })].building = makeBuilding({
   //     type: "Farmland",
   //     status: "completed",
   // });

   // gameState.tiles[pointToXy({ x: center.x + 4, y: center.y + 1 })].building = makeBuilding({
   //     type: "LivestockFarm",
   //     status: "completed",
   // });

   // gameState.tiles[pointToXy({ x: center.x + 5, y: center.y + 1 })].building = makeBuilding({
   //     type: "StonemasonsWorkshop",
   // });

   // const xy5 = pointToXy({ x: center.x + 5, y: center.y + 2 });
   // gameState.tiles[xy5].building = makeBuilding({ type: "StoneQuarry", status: "completed" });
   // gameState.tiles[xy5].deposit.Stone = true;

   // const xy6 = pointToXy({ x: center.x + 4, y: center.y + 2 });
   // gameState.tiles[xy6].building = makeBuilding({ type: "LoggingCamp" });
   // gameState.tiles[xy6].deposit.Wood = true;

   // const wonders = keysOf(gameState.currentTick.buildings).filter(
   //     (b) => gameState.currentTick.buildings[b].max === 1 && b !== "Headquarter"
   // );
   // const row = 6;
   // const col = wonders.length / row;
   // for (let x = 0; x < col; x++) {
   //     for (let y = 0; y < row; y++) {
   //         const building = wonders[y + x * row];
   //         if (!building) {
   //             break;
   //         }
   //         gameState.tiles[pointToXy({ x: center.x - 2 + x, y: center.y + 3 + y })].building = makeBuilding({
   //             type: building,
   //             status: "completed",
   //         });
   //     }
   // }

   const naturalWonders = keysOf(Config.City[gameState.city].naturalWonders);
   const xys = shuffle(Array.from(gameState.tiles.keys()));
   for (let i = 0; i < xys.length; i++) {
      const xy = xys[i];
      if (gameState.tiles.get(xy)!.building || !isEmpty(gameState.tiles.get(xy)!.deposit)) {
         continue;
      }
      if (naturalWonders.length <= 0) {
         break;
      }
      const naturalWonder = naturalWonders.pop()!;
      gameState.tiles.get(xy)!.building = makeBuilding({
         type: naturalWonder,
         level: 1,
         status: "completed",
      });
   }

   gameState.tiles.forEach((tile, xy) => {
      if (tile.building) {
         ensureTileFogOfWar(xy, gameState, grid);
      }
   });
}
