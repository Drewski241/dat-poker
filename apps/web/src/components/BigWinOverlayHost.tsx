import type { BigWinOverlay } from "../lucky-irish.js";
import { ChampionshipBeltWin } from "./ChampionshipBeltWin.js";
import { FireworksBigWin } from "./FireworksBigWin.js";
import { HunterBullseyeWin } from "./HunterBullseyeWin.js";
import { LeprechaunVaultWin } from "./LeprechaunVaultWin.js";
import { LuckyIrishWin } from "./LuckyIrishWin.js";
import { OwlMicDropWin } from "./OwlMicDropWin.js";
import { PinataChipWin } from "./PinataChipWin.js";
import { SlothChampagneWin } from "./SlothChampagneWin.js";
import { SuperheroFlyWin } from "./SuperheroFlyWin.js";
import { TerrierVictoryLapWin } from "./TerrierVictoryLapWin.js";
import { UfoBeamWin } from "./UfoBeamWin.js";

export function BigWinOverlayHost({
  overlay,
  onFinished,
}: {
  overlay: BigWinOverlay;
  onFinished: () => void;
}) {
  switch (overlay) {
    case "irish":
      return <LuckyIrishWin onFinished={onFinished} />;
    case "hunter":
      return <HunterBullseyeWin onFinished={onFinished} />;
    case "hero":
      return <SuperheroFlyWin onFinished={onFinished} />;
    case "sloth":
      return <SlothChampagneWin onFinished={onFinished} />;
    case "terrier":
      return <TerrierVictoryLapWin onFinished={onFinished} />;
    case "owl":
      return <OwlMicDropWin onFinished={onFinished} />;
    case "vault":
      return <LeprechaunVaultWin onFinished={onFinished} />;
    case "fireworks":
      return <FireworksBigWin onFinished={onFinished} />;
    case "pinata":
      return <PinataChipWin onFinished={onFinished} />;
    case "ufo":
      return <UfoBeamWin onFinished={onFinished} />;
    case "belt":
      return <ChampionshipBeltWin onFinished={onFinished} />;
  }
}
