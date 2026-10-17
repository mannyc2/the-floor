# Trader sources

The live floor's trader is built from these files by `apps/web/kit/traders` whenever the web app is built or served. Nothing here is drawn as it is: the build retargets the motion onto the body, dresses and simplifies the body, and bakes one `trader-kit.bin` beside the page.

| Files | Source | License |
| --- | --- | --- |
| `Superhero_Male_FullBody.*`, `Superhero_Female_FullBody.*`, `Hair_*.*` | [Universal Base Characters](https://quaternius.itch.io/universal-base-characters), Standard version, by Quaternius | CC0 1.0 |
| `UAL1_Standard.glb` | [Universal Animation Library](https://quaternius.itch.io/universal-animation-library), Standard version, by Quaternius | CC0 1.0 |

The bodies and hair are the packs' glTF exports rigged to the shared 65-joint humanoid skeleton ("Godot - UE" and "Rigged to Head Bone"); their textures are left out, because the trader is painted from the Atlas palette. The motion library is the in-place export, without root motion.
