/**
 * Respuestas de ATLAS en curso. Permite:
 *  - impedir dos respuestas simultáneas en la misma conversación,
 *  - detener una respuesta (botón "detener"),
 *  - detenerlo todo (botón de emergencia).
 */
export class ActiveTurns {
  private byConversation = new Map<number, { userId: number; controller: AbortController }>();

  begin(userId: number, conversationId: number): AbortController | null {
    if (this.byConversation.has(conversationId)) return null;
    const controller = new AbortController();
    this.byConversation.set(conversationId, { userId, controller });
    return controller;
  }

  end(conversationId: number, controller: AbortController) {
    if (this.byConversation.get(conversationId)?.controller === controller) this.byConversation.delete(conversationId);
  }

  isActive(conversationId: number) {
    return this.byConversation.has(conversationId);
  }

  stop(userId: number, conversationId: number): boolean {
    const t = this.byConversation.get(conversationId);
    if (!t || t.userId !== userId) return false;
    t.controller.abort(new Error("stopped"));
    return true;
  }

  stopAll(userId: number): number {
    let n = 0;
    for (const [, t] of this.byConversation) {
      if (t.userId === userId) {
        t.controller.abort(new Error("emergency"));
        n++;
      }
    }
    return n;
  }
}
