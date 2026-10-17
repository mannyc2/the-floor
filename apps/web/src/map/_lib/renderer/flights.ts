import * as THREE from "three";

// Paper planes in flight. A trader who throws one releases it from the hand;
// it arcs across the aisle, nose along its path with a little wobble, and is
// gone when it lands. A small pool is enough: throws are rare.

interface Flight {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly start: number;
  readonly duration: number;
  readonly arc: number;
  readonly wobble: number;
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export const makeFlights = (mesh: THREE.InstancedMesh, unitsPerH: number) => {
  const visible = mesh.geometry.getAttribute("_INSTANCE_FROM");
  const flights: Array<Flight | false> = Array.from({ length: mesh.count }, () => false);
  const point = new THREE.Vector3(), ahead = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), roll = new THREE.Quaternion();
  const scale = new THREE.Vector3(unitsPerH, unitsPerH, unitsPerH);
  const show = (index: number, on: boolean) => {
    if (visible instanceof THREE.InstancedBufferAttribute) {
      visible.setW(index, on ? 1 : 0);
      visible.needsUpdate = true;
    }
  };
  const at = (flight: Flight, t: number, out: THREE.Vector3) =>
    out.lerpVectors(flight.from, flight.to, t).addScaledVector(up, flight.arc * 4 * t * (1 - t));
  return {
    // Releases a plane from `from` toward `to`, both in world units.
    launch: (from: THREE.Vector3, to: THREE.Vector3, now: number, wobble: number) => {
      const index = flights.findIndex(flight => flight === false);
      if (index < 0) return;
      const distance = from.distanceTo(to) / unitsPerH;
      flights[index] = {
        from: from.clone(),
        to: to.clone(),
        start: now,
        duration: .7 + distance * .32,
        arc: (.25 + distance * .12) * unitsPerH,
        wobble,
      };
      show(index, true);
    },
    tick: (now: number) => {
      let flying = false;
      flights.forEach((flight, index) => {
        if (flight === false) return;
        const t = (now - flight.start) / flight.duration;
        if (t >= 1) {
          flights[index] = false;
          mesh.setMatrixAt(index, hidden);
          show(index, false);
          return;
        }
        at(flight, t, point);
        at(flight, Math.min(1, t + .02), ahead).sub(point);
        // Nose along the path; a gentle roll as it glides.
        matrix.lookAt(new THREE.Vector3(), ahead.negate(), up);
        turn.setFromRotationMatrix(matrix);
        roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin((now - flight.start) * 9 + flight.wobble) * .35);
        mesh.setMatrixAt(index, matrix.compose(point, turn.multiply(roll), scale));
        flying = true;
      });
      mesh.instanceMatrix.needsUpdate = true;
      return flying;
    },
  };
};
export type Flights = ReturnType<typeof makeFlights>;
