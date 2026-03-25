import { useMemo } from "react";
import {
  buildMessageListItems,
  type BuildMessageListItemsParams,
  type ListItem,
} from "./listModel";

type UseMessageListItemsParams = BuildMessageListItemsParams;

export function useMessageListItems({
  groupedMessages,
  collapsedGroups,
  collapsedThreads,
  supportsThreads,
  includeThreadAcrossFolders,
  searchScope,
  activeFolderId,
  buildThreadTree,
  flattenThread,
  getThreadLatestDate,
  userEmail,
  preferToDisplay,
  findRecipientAlias,
  mode,
  collapsedNestedMessages
}: UseMessageListItemsParams): ListItem[] {
  return useMemo(
    () =>
      buildMessageListItems({
        groupedMessages,
        collapsedGroups,
        collapsedThreads,
        supportsThreads,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId,
        buildThreadTree,
        flattenThread,
        getThreadLatestDate,
        userEmail,
        preferToDisplay,
        findRecipientAlias,
        mode,
        collapsedNestedMessages
      }),
    [
      groupedMessages,
      collapsedGroups,
      collapsedThreads,
      supportsThreads,
      includeThreadAcrossFolders,
      searchScope,
      activeFolderId,
      buildThreadTree,
      flattenThread,
      getThreadLatestDate,
      userEmail,
      preferToDisplay,
      findRecipientAlias,
      mode,
      collapsedNestedMessages
    ]
  );
}
