import {
  UPDATE_STATE, SET_STATE, LIFTED_ACTION,
  SELECT_INSTANCE, REMOVE_INSTANCE, TOGGLE_SYNC
} from '../constants/actionTypes';
import { DISCONNECTED } from '../constants/socketActionTypes';
import parseJSON from '../utils/parseJSON';
import { recompute } from '../utils/updateState';

export const initialState = {
  selected: null,
  current: 'default',
  sync: false,
  connections: {},
  options: { default: {} },
  states: {
    default: {
      actionsById: {},
      computedStates: [],
      currentStateIndex: -1,
      monitorState: {},
      nextActionId: 0,
      skippedActionIds: [],
      stagedActionIds: []
    }
  }
};

function updateState(state, request, id) {
  let payload = request.payload;
  const actionsById = request.actionsById;
  if (actionsById) {
    const committedState = request.committedState;
    payload = {
      ...payload,
      actionsById: JSON.parse(actionsById),
      computedStates: JSON.parse(request.computedStates),
      committedState: committedState ? JSON.parse(request.committedState) : committedState
    };
  } else {
    payload = parseJSON(payload);
  }

  let newState;
  const action = request.action && parseJSON(request.action) || {};

  switch (request.type) {
    case 'INIT':
      newState = recompute(
        state.default,
        payload,
        { action: { type: '@@INIT' }, timestamp: action.timestamp || Date.now() }
      );
      break;
    case 'ACTION':
      const liftedState = state[id] || state.default;
      newState = recompute(
        liftedState,
        payload,
        action,
        request.nextActionId || (liftedState.nextActionId + 1),
        request.isExcess
      );
      break;
    case 'STATE':
      newState = payload;
      break;
    default:
      return state;
  }

  return { ...state, [id]: newState };
}

export function dispatchAction(state, { action }) {
  if (action.type === 'JUMP_TO_STATE') {
    const id = state.selected || state.current;
    const liftedState = state.states[id];
    return {
      ...state,
      states: {
        ...state.states,
        [id]: { ...liftedState, currentStateIndex: action.index }
      }
    };
  }
  return state;
}

function removeState(state, connectionId) {
  const instanceIds = state.connections[connectionId];
  if (!instanceIds) return state;

  const connections = { ...state.connections };
  const options = { ...state.options };
  const states = { ...state.states };
  let selected = state.selected;
  let current = state.current;
  let sync = state.sync;

  delete connections[connectionId];
  instanceIds.forEach(id => {
    if (id === selected) {
      selected = null;
      sync = false;
    }
    if (id === current) {
      const inst = Object.keys(connections)[0];
      if (inst) current = connections[inst][0];
      else current = 'default';
    }
    delete options[id];
    delete states[id];
  });
  return {
    selected,
    current,
    sync,
    connections,
    options,
    states
  };
}

function init({ type, action, name }, connectionId, current) {
  let lib;
  let actionCreators;
  let creators = action;
  if (typeof creators === 'string') creators = JSON.parse(creators);
  if (Array.isArray(creators)) actionCreators = creators;
  if (type === 'STATE') lib = 'redux';
  return {
    name: name || current,
    connectionId,
    lib,
    actionCreators
  };
}

export default function instances(state = initialState, action) {
  switch (action.type) {
    case UPDATE_STATE:
      const { request } = action;
      if (!request) return state;
      const connectionId = action.id || request.id;
      const current = request.instanceId || connectionId;
      let connections = state.connections;
      let options = state.options;

      if (typeof state.options[current] === 'undefined') {
        connections = {
          ...state.connections,
          [connectionId]: [...(connections[connectionId] || []), current]
        };
        options = { ...options, [current]: init(request, connectionId, current) };
      }

      return {
        ...state,
        current,
        connections,
        options,
        states: updateState(state.states, request, current)
      };
    case SET_STATE:
      return {
        ...state,
        states: {
          ...state.states,
          [state.selected || state.current]: action.newState
        }
      };
    case TOGGLE_SYNC:
      return { ...state, sync: !state.sync };
    case SELECT_INSTANCE:
      if (!state.options[action.selected]) return state;
      return { ...state, selected: action.selected, sync: false };
    case REMOVE_INSTANCE:
      return removeState(state, action.id);
    case LIFTED_ACTION:
      if (action.message === 'DISPATCH') return dispatchAction(state, action);
      return state;
    case DISCONNECTED:
      return initialState;
    default:
      return state;
  }
}

/* eslint-disable no-shadow */
export const getActiveInstance = instances => instances.selected || instances.current;
/* eslint-enable */
