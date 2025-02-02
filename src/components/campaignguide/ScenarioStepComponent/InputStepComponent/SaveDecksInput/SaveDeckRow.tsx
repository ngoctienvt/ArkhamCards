import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { flatMap, find, forEach, map, sortBy } from 'lodash';
import { t } from 'ttag';
import { Action } from 'redux';
import { useDispatch } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';

import { Deck, Slots, getDeckId, DeckId, NumberChoices } from '@actions/types';
import { BODY_OF_A_YITHIAN } from '@app_constants';
import { useCounter, useFlag } from '@components/core/hooks';
import CardSearchResult from '@components/cardlist/CardSearchResult';
import { showCard } from '@components/nav/helper';
import useCardList from '@components/card/useCardList';
import { fetchPrivateDeck, saveDeckChanges, SaveDeckChanges } from '@components/deck/actions';
import Card from '@data/types/Card';
import space, { s, xs } from '@styles/space';
import CampaignStateHelper from '@data/scenario/CampaignStateHelper';
import ScenarioStateHelper from '@data/scenario/ScenarioStateHelper';
import GuidedCampaignLog from '@data/scenario/GuidedCampaignLog';
import StyleContext from '@styles/StyleContext';
import ArkhamCardsAuthContext from '@lib/ArkhamCardsAuthContext';
import { DeckActions } from '@data/remote/decks';
import LatestDeckT from '@data/interfaces/LatestDeckT';
import ShowDeckButton from '../ShowDeckButton';
import ArkhamSwitch from '@components/core/ArkhamSwitch';
import { AnimatedCompactInvestigatorRow } from '@components/core/CompactInvestigatorRow';
import DeckSlotHeader from '@components/deck/section/DeckSlotHeader';
import ActionButton from '@components/campaignguide/prompts/ActionButton';
import { useAppDispatch } from '@app/store';
import useTraumaSection from '../UpgradeDecksInput/useTraumaSection';

function deckMessage(saved: boolean, hasDeck: boolean, hasAdjustments: boolean, hasDeckChanges: boolean, isOwner: boolean) {
  if (saved) {
    return t`Changes have been recorded.`;
  }
  if (!hasDeck) {
    if (!hasAdjustments) {
      return t`No adjustments need saving.`;
    }
    return t`When you have finished making adjustments, press the 'Save' button to record your changes.`;
  }
  if (!isOwner) {
    return t`This deck is owned by another player. You can record the upgrade now and they will be given an opportunity to save the changes to their deck when they next open the app.`;
  }
  if (!hasAdjustments && !hasDeckChanges) {
    return t`No adjustments need saving.`;
  }
  return t`When you have finished making adjustments, press the 'Save' button to record your changes.`;
}
interface Props {
  componentId: string;
  id: string;
  campaignState: CampaignStateHelper;
  scenarioState: ScenarioStateHelper;
  investigator: Card;
  deck?: LatestDeckT;
  campaignLog: GuidedCampaignLog;
  editable: boolean;
  actions: DeckActions;
  includeTrauma: boolean;
}
type DeckDispatch = ThunkDispatch<AppState, unknown, Action<string>>;

function computeChoiceId(stepId: string, investigator: Card) {
  return `${stepId}#${investigator.code}`;
}

function SaveDeckRow({
  componentId,
  id,
  campaignState,
  scenarioState,
  investigator,
  deck,
  campaignLog,
  editable,
  actions,
  includeTrauma,
}: Props) {
  const { colors, typography, width } = useContext(StyleContext);
  const { userId, arkhamDbUser } = useContext(ArkhamCardsAuthContext);
  const deckDispatch: DeckDispatch = useDispatch();
  const dispatch = useAppDispatch();
  const choiceId = useMemo(() => {
    return computeChoiceId(id, investigator);
  }, [id, investigator]);
  const [saving, setSaving] = useState(false);
  const [physicalAdjust, incPhysical, decPhysical] = useCounter(0, {});
  const [mentalAdjust, incMental, decMental] = useCounter(0, {});

  const saveCampaignLog = useCallback(async(deckId?: DeckId) => {
    const choices: NumberChoices = includeTrauma ? {
      physical: [physicalAdjust],
      mental: [mentalAdjust],
    } : {};
    await scenarioState.setNumberChoices(choiceId, choices, deckId);
    setSaving(false);
  }, [scenarioState, choiceId, setSaving, physicalAdjust, mentalAdjust, includeTrauma]);
  const [choices, deckChoice, deckEditsChoice] = useMemo(() => scenarioState.numberAndDeckChoices(choiceId), [scenarioState, choiceId]);
  const storyAssetDeltas = useMemo(() => campaignLog.storyAssetChanges(investigator.code), [campaignLog, investigator]);

  const save = useCallback(() => {
    if (deck) {
      setSaving(true);
      const slots: Slots = { ...deck.deck.slots };
      const allowedChanges = !!find(storyAssetDeltas, (delta, code) => deck.id.local || !code.startsWith('z'));
      if (!allowedChanges) {
        saveCampaignLog(deck.id);
      } else {
        forEach(storyAssetDeltas, (delta, code) => {
          if (code.startsWith('z') && !deck.id.local) {
            return;
          }
          slots[code] = (slots[code] || 0) + delta;
          if (!slots[code]) {
            delete slots[code];
          }
        });
        const changes: SaveDeckChanges = { slots };
        deckDispatch(saveDeckChanges(userId, actions, deck.deck, changes) as any).then(
          (d: Deck) => saveCampaignLog(getDeckId(d))
        );
      }
    } else {
      saveCampaignLog();
    }
  }, [deck, userId, actions, deckDispatch, storyAssetDeltas, saveCampaignLog, setSaving]);

  const onCardPress = useCallback((card: Card) => {
    showCard(componentId, card.code, card, colors, true);
  }, [componentId, colors]);

  const renderDeltas = useCallback((cards: Card[], deltas: Slots) => {
    return map(
      sortBy(cards, card => card.name),
      card => (
        <CardSearchResult
          key={card.code}
          onPress={onCardPress}
          card={card}
          backgroundColor="transparent"
          control={{
            type: 'count',
            count: deltas[card.code],
            deltaCountMode: true,
          }}
        />
      )
    );
  }, [onCardPress]);
  useEffect(() => {
    // We only want to save once.
    if (choices === undefined && deck && !deck.id.local && deck.id.arkhamdb_user === arkhamDbUser) {
      dispatch(fetchPrivateDeck(userId, actions, deck.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const storyAssets = useMemo(() => campaignLog.storyAssets(investigator.code), [campaignLog, investigator]);
  const storyAssetCodes = useMemo(() => flatMap(storyAssetDeltas, (count, code) => count !== 0 ? code : []), [storyAssetDeltas]);
  const [storyAssetCards] = useCardList(storyAssetCodes, 'player');
  const storyAssetSection = useMemo(() => {
    if (!storyAssetCards.length) {
      return null;
    }
    return (
      <>
        <View style={space.paddingSideS}><DeckSlotHeader title={t`Campaign cards` } /></View>
        { renderDeltas(storyAssetCards, storyAssetDeltas) }
      </>
    );
  }, [storyAssetDeltas, storyAssetCards, renderDeltas]);

  const selectDeck = useCallback(() => {
    campaignState.showChooseDeck(investigator);
  }, [campaignState, investigator]);

  const traumaSection = useTraumaSection({ campaignLog, investigator, saving, editable, choices, physicalAdjust, incPhysical, decPhysical, mentalAdjust, incMental, decMental });

  const [unsavedAdjustments, deckChanges] = useMemo(() => {
    return [physicalAdjust !== 0 || mentalAdjust !== 0,
      !!deck && !!find(storyAssetDeltas, (count: number) => count !== 0)
    ];
  }, [storyAssetDeltas, physicalAdjust, mentalAdjust, deck]);

  const [secondSection, secondMessage] = useMemo(() => {
    const show = (deck ? choices !== undefined : choices === undefined);
    if (!deck) {
      return [
        show,
        t`This investigator does not have a deck associated with it.\nIf you choose a deck, the app can help track spent experience, story asset changes, and deckbuilding requirements.`,
      ];
    }
    if (deckEditsChoice && !deckEditsChoice.resolved) {
      if (deck.owner && userId && deck.owner.id === userId) {
        return [show, t`Changes have been recorded. You can apply these changes to your deck on the main screen of the campaign under your investigator.`];
      }
      return [show, t`Changes have been recorded. The owner of this deck can apply these changes to their deck on the main screen of the campaign under their investigator.`];
    }

    if (!deck.owner || !userId || deck.owner.id === userId) {
      return [show, t`Now that your upgrade has been saved, when visiting the deck be sure to use the 'Edit' button when making card changes.`];
    }
    return [false, undefined];
  }, [deck, choices, userId, deckEditsChoice]);

  const footer = useMemo(() => {
    if (deck && deck.owner && userId && deck.owner.id !== userId && editable) {
      return (
        <View style={[space.paddingS, { flexDirection: 'column', backgroundColor: colors.L10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }]}>
          <View style={choices !== undefined ? styles.startRow : styles.startColumn}>
            <ActionButton
              color={choices !== undefined ? 'green' : 'dark'}
              leftIcon="check"
              title={choices !== undefined ? t`Not deck owner` : t`Saved`}
              onPress={save}
              disabled
            />
            <View style={[styles.column, { flex: 1 }, space.paddingLeftS, choices === undefined ? space.marginTopS : undefined]}>
              <Text style={[typography.small, typography.italic, typography.light]}>
                { deck.owner?.handle ?
                  t`This deck is owned by ${deck.owner.handle}. They must open the app on their own device to save the upgrade` :
                  t`This deck is owned by another user. They must open the app on their own device to save the upgrade` }
              </Text>
            </View>
          </View>
        </View>
      );
    }
    const currentMessage = saving ? t`Saving` : t`Save`;
    const deckButton = deck && choices !== undefined && deckChoice && (
      <ShowDeckButton
        deckId={deckChoice}
        investigator={investigator}
      />
    );
    return (
      <View style={[space.paddingS, { flexDirection: 'column', backgroundColor: colors.L10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }]}>
        <View style={[styles.startRow, secondSection ? { paddingBottom: xs, borderBottomWidth: 1, borderColor: colors.L30 } : undefined]}>
          <ActionButton
            color="green"
            leftIcon="check"
            title={choices !== undefined ? t`Saved` : currentMessage}
            onPress={save}
            disabled={choices !== undefined || (!unsavedAdjustments && (!deck || !deckChanges))}
            loading={saving}
          />
          <View style={[styles.column, { flex: 1 }, space.paddingLeftS]}>
            <Text style={[typography.small, typography.italic, typography.light]}>
              { deckMessage(choices !== undefined, !!deck, unsavedAdjustments, deckChanges, !userId || !deck || !deck.owner || userId === deck.owner.id) }
            </Text>
          </View>
        </View>
        { secondSection && (
          <View style={[styles.column, space.paddingTopXs]}>
            { !deck ? (
              <>
                <Text style={[typography.small, typography.italic, typography.light]}>
                  { secondMessage }
                </Text>
                <View style={[space.paddingTopS, styles.startRow]}>
                  <ActionButton leftIcon="deck" color="dark" title={t`Choose deck`} onPress={selectDeck} />
                </View>
              </>
            ) : deckButton}
          </View>
        ) }
      </View>
    );
  }, [choices, colors, unsavedAdjustments, deckChanges, secondSection, secondMessage, deck, deckChoice, editable, investigator, save, saving, selectDeck, typography, userId]);
  const [open, toggleOpen] = useFlag(choices === undefined);
  if (!find(storyAssetDeltas, (count: number) => count !== 0) && !includeTrauma) {
    return null;
  }
  const isYithian = storyAssets && (storyAssets[BODY_OF_A_YITHIAN] || 0) > 0;
  return (
    <View style={space.paddingBottomS}>
      <AnimatedCompactInvestigatorRow
        yithian={isYithian}
        investigator={investigator}
        open={choices === undefined || open}
        toggleOpen={toggleOpen}
        disabled={choices === undefined}
        headerContent={!open && editable && <ArkhamSwitch value large color="light" />}
        width={width - s * (editable ? 4 : 2)}
      >
        { !!includeTrauma && traumaSection }
        { storyAssetSection }
        { footer }
      </AnimatedCompactInvestigatorRow>
    </View>
  );
}

SaveDeckRow.choiceId = computeChoiceId;
export default SaveDeckRow;

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
    flex: 1,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  startColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
});
