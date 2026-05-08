import type { AstraSection, AstraWork } from '../AstraInterfaces';

export interface ParsedAstraReport {
  overallScore?: number;
  sectionScores: Record<string, number>;
  subSectionScores: Record<string, number>;
  generalNotes?: string;
  ratingNotes?: string;
  journal: Record<number, string>;
  cleanText?: string;
}

/**
 * Represents text decomposed into Astra-specific compartments.
 */
export interface AstraDecomposition {
  top: string;      // Text before the Astra block
  block: string;    // The Astra metadata block itself
  bottom: string;   // Text after the Astra block
}

/**
 * Interface for the Astra Parser Service.
 * Responsible for structured data extraction and metadata injection.
 */
export interface IAstraParser {
  /**
   * Decomposes a string into Top, Astra Block, and Bottom compartments.
   */
  decompose(text: string): AstraDecomposition;

  /**
   * Composes a string from Top, Astra Block, and Bottom compartments.
   */
  compose(parts: AstraDecomposition): string;

  /**
   * Parses text to extract Astra metadata.
   */
  parse(text: string, sections: AstraSection[]): ParsedAstraReport | null;

  /**
   * Merges parsed data into a work object.
   */
  merge(work: AstraWork, parsed: ParsedAstraReport): boolean;

  /**
   * Serializes a work object into a metadata block string.
   */
  serialize(work: AstraWork, sections: AstraSection[]): string;

  /**
   * Injects or replaces the Astra metadata block in a text string.
   */
  inject(text: string, work: AstraWork, sections: AstraSection[], moveNotesIntoBlock?: boolean): string;
}
