// Objective chain. Each objective is a declarative check evaluated by sim/missions.js.
// kinds: stat (state.stats[key] >= target), build (count of type >= count),
//        research (tech unlocked), waves (waves survived >= target),
//        activeExtractors (extractors currently producing >= target)
export const MISSIONS = [
  { id: 'm_mine', text: 'Mine 20 Scrap by hand and deliver it to the Core', kind: 'stat', key: 'manualDeposited', target: 20, reward: { scrap: 20 } },
  { id: 'm_extractor', text: 'Build an Extractor on a Scrap deposit', kind: 'build', type: 'extractor', count: 1, reward: { scrap: 15 } },
  { id: 'm_generator', text: 'Build a Generator to power the network', kind: 'build', type: 'generator', count: 1, reward: { scrap: 20 } },
  { id: 'm_turret', text: 'Build a Pulse Turret — expansion attracts attention', kind: 'build', type: 'turret', count: 1, reward: { scrap: 20 } },
  { id: 'm_wave1', text: 'Survive the first attack', kind: 'waves', target: 1, reward: { data: 4 } },
  { id: 'm_lab', text: 'Build a Research Node and collect Data from ruins', kind: 'build', type: 'research_node', count: 1, reward: { data: 4 } },
  { id: 'm_drones', text: 'Research Drone Logistics', kind: 'research', tech: 't_drones', reward: { scrap: 40 } },
  { id: 'm_hub', text: 'Build a Drone Hub near your extractors', kind: 'build', type: 'drone_hub', count: 1, reward: { scrap: 30 } },
  { id: 'm_processing', text: 'Research Basic Processing', kind: 'research', tech: 't_processing', reward: { scrap: 40 } },
  { id: 'm_components', text: 'Produce 20 Components', kind: 'stat', key: 'componentsProduced', target: 20, reward: { data: 8 } },
  { id: 'm_four', text: 'Run 4 Extractors at the same time', kind: 'activeExtractors', target: 4, reward: { components: 10 } },
  { id: 'c_uptime', text: 'Contract: keep full power for 3 minutes straight', kind: 'stat', key: 'powerOkStreak', target: 180, reward: { components: 15 } },
  { id: 'c_delivery', text: 'Contract: drones deliver 500 resources', kind: 'stat', key: 'droneDelivered', target: 500, reward: { data: 20 } },
  { id: 'c_wave8', text: 'Contract: survive 8 attacks', kind: 'waves', target: 8, reward: { components: 25, data: 15 } },
  { id: 'c_autonomy', text: 'Contract: research the Surplus Policy', kind: 'research', tech: 't_autonomy', reward: { components: 30 } },
];
