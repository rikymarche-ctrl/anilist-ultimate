/** Shared by immediate saves and durable retries so no fields are lost offline. */
export const SAVE_ASTRA_ENTRY = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$notes:String,$lists:[String],$startedAt:FuzzyDateInput,$completedAt:FuzzyDateInput) {
  SaveMediaListEntry(
    mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,
    repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,notes:$notes,
    customLists:$lists,startedAt:$startedAt,completedAt:$completedAt
  ) { id mediaId userId }
}`;

export const DELETE_ASTRA_ENTRY = `mutation($id:Int!) {
  DeleteMediaListEntry(id:$id) { deleted }
}`;
